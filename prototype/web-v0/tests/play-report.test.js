'use strict';

const assert = require('node:assert/strict');
const { Game } = require('../game-core.js');
const SaveSystem = require('../save-system.js');
const Report = require('../play-report.js');

function test(name, fn) {
  try {
    fn();
    console.log('✓ ' + name);
  } catch (error) {
    console.error('✗ ' + name);
    throw error;
  }
}

const seed = 'playtest-log-seed';
const actions = [
  { type: 'buy', productId: 'rice', qty: 3 },
  { type: 'travel', destinationId: 'busan' },
  { type: 'sell', productId: 'rice', qty: 2 },
  { type: 'travel', destinationId: 'fukuoka' }
];

test('저장 가능한 행동만으로 거래 기록과 회계 결과를 재구축한다', () => {
  const game = new Game({ seed, maxDay: 30 });
  actions.forEach((action) => SaveSystem.applyAction(game, action));
  const report = Report.buildReport({ seed, maxDay: 30, actions }, Game, SaveSystem);

  assert.equal(report.startingAssets, 10000);
  assert.equal(report.finalAssets, game.totalAssets());
  assert.equal(report.finalCash, game.cash);
  assert.equal(report.netAssetsChange, game.totalAssets() - 10000);
  assert.deepEqual(report.stats, game.stats);
  assert.equal(report.productTotals.rice.bought, 3);
  assert.equal(report.productTotals.rice.sold, 2);
  assert.equal(report.productTotals.rice.realizedProfit, report.bestSale.profit);
  assert.ok(report.stats.transportCost > 0);
  assert.equal(report.routeCounts['seoul->busan'], 1);
  assert.equal(report.routeCounts['busan->fukuoka'], 1);
  assert.equal(report.cityVisits.seoul, 1);
  assert.equal(report.cityVisits.busan, 1);
  assert.equal(report.cityVisits.fukuoka, 1);
  assert.equal(report.currentCityId, game.cityId);
  assert.equal(report.currentDay, game.day);
  assert.equal(report.completed, false);
});

test('최고/최악 판매와 현금·자산 변화는 실제 게임 실행값에 기반한다', () => {
  const report = Report.buildReport({ seed, actions }, Game, SaveSystem);
  assert.equal(report.bestSale.type, 'sell');
  assert.equal(report.worstSale.type, 'sell');
  assert.equal(report.bestSale.quantity, 2);
  assert.equal(report.timeline.filter((row) => row.type !== 'event').length, actions.length);

  const start = report.dailyAssets[0];
  const end = report.dailyAssets[report.dailyAssets.length - 1];
  assert.equal(start.day, 1);
  assert.equal(start.assets, report.timeline.find((row) => row.type === 'buy').assetsAfter);
  assert.equal(end.day, report.currentDay);
  assert.equal(end.assets, report.finalAssets);
  assert.equal(end.cash, report.finalCash);
  assert.equal(new Set(report.dailyAssets.map((row) => row.day)).size, report.dailyAssets.length);
  // Intermediate days with no observed state must not be invented.
  assert.ok(report.dailyAssets.length <= report.currentDay);
});

test('저장 후 복원한 행동 이력으로 동일한 리포트를 생성한다', () => {
  const payload = SaveSystem.createSavePayload({ seed, maxDay: 30, actions });
  const restored = SaveSystem.restoreGame(payload, Game);
  const a = Report.buildReport({ seed, maxDay: 30, actions }, Game, SaveSystem);
  const b = Report.buildReport({
    seed: restored.seed,
    maxDay: restored.maxDay,
    actions: restored.actions
  }, Game, SaveSystem);
  assert.deepEqual(b, a);
  assert.deepEqual(JSON.parse(JSON.stringify(a)), a);
});

test('끝나지 않은 게임과 거래가 없는 게임에도 내보내기 리포트가 생성된다', () => {
  const report = Report.buildReport({ seed: 'no-trades', maxDay: 30, actions: [] }, Game, SaveSystem);
  assert.equal(report.completed, false);
  assert.equal(report.bestSale, null);
  assert.equal(report.worstSale, null);
  assert.equal(report.leadingProduct, null);
  assert.equal(report.busiestRoute, null);
  assert.equal(report.visibleEvents.length, 0);
  assert.equal(report.dailyAssets.length, 1);
  assert.equal(report.timeline.length, 0);
});

test('게임 종료 이동도 마지막 기록에 반영된다', () => {
  const report = Report.buildReport({
    seed: 'short-game',
    maxDay: 2,
    actions: [{ type: 'travel', destinationId: 'busan' }]
  }, Game, SaveSystem);
  assert.equal(report.completed, true);
  assert.equal(report.currentDay, 2);
  assert.equal(report.timeline.filter((item) => item.type === 'travel').length, 1);
  assert.equal(report.dailyAssets.at(-1).assets, report.finalAssets);
});

test('현재 플레이어에게 보이는 사건만 기록하고 원격 내부 시세는 내보내지 않는다', () => {
  const report = Report.buildReport({ seed, maxDay: 30, actions }, Game, SaveSystem);
  const exported = JSON.stringify(report);
  assert.equal('marketDynamics' in report, false);
  assert.equal('intelSnapshots' in report, false);
  assert.equal('market' in report, false);
  assert.equal('inventory' in report, false);
  for (const entry of report.visibleEvents) {
    assert.ok(['rumor', 'partial', 'full', 'public'].includes(entry.precision));
    assert.equal('impact' in entry, false);
    assert.equal('stockTargetMultiplier' in entry, false);
  }
  assert.ok(exported.includes('"timeline"'));
});

test('시세 조회 기록은 실제 공개 정보만 담고 게임 상태를 변경하지 않는다', () => {
  const game = new Game({ seed: 'intel-view-read-only' });
  const before = game.snapshot();
  const remote = Report.captureIntelView(game, 'shanghai');
  const local = Report.captureIntelView(game, 'seoul');

  assert.equal(remote.type, 'intel_view');
  assert.equal(remote.targetCityId, 'shanghai');
  assert.equal(remote.intelLevel, 0);
  assert.equal(remote.live, false);
  assert.equal(remote.entries.length, 0);
  assert.equal(local.live, true);
  assert.equal(local.entries.length, 12);
  assert.ok(local.entries.every((entry) => Number.isFinite(entry.price)));
  assert.deepEqual(game.snapshot(), before);
});

test('항로 왕복 집계는 방향을 구분하지 않는다', () => {
  assert.equal(Report.pairKey('seoul', 'busan'), 'busan<->seoul');
  assert.equal(Report.pairKey('busan', 'seoul'), 'busan<->seoul');
});

test('실패한 거래는 플레이 기록에 포함되지 않는다', () => {
  assert.throws(() => Report.buildReport({
    seed, maxDay: 30,
    actions: [{ type: 'buy', productId: 'rice', qty: 1000 }]
  }, Game, SaveSystem), /재고/);
});

test('화물칸 투자비와 정보망 투자비를 판매 실현손익에서 구분한다', () => {
  const cargo = Report.buildReport({
    seed: 'upgrade-cost-cargo', maxDay: 30,
    actions: [{ type: 'upgradeCargo' }]
  }, Game, SaveSystem);
  assert.equal(cargo.investmentCosts.cargo, 8000);
  assert.equal(cargo.investmentCosts.intel, 0);
  assert.equal(cargo.investmentCosts.total, 8000);
  assert.equal(cargo.stats.realizedProfit, 0);
  assert.equal(cargo.realizedAfterTransport, 0);
  assert.equal(cargo.realizedAfterExpenses, -8000);
  assert.equal(cargo.netAssetsChange, -8000);
  assert.equal(cargo.timeline[0].cost, 8000);

  const intel = Report.buildReport({
    seed: 'upgrade-cost-intel', maxDay: 30,
    actions: [{ type: 'upgradeIntel' }]
  }, Game, SaveSystem);
  assert.equal(intel.investmentCosts.intel, 6000);
  assert.equal(intel.investmentCosts.cargo, 0);
  assert.equal(intel.investmentCosts.total, 6000);
  assert.equal(intel.realizedAfterExpenses, -6000);
});

test('운송비 차감 실현손익과 자산 증감은 서로 다른 지표다', () => {
  const report = Report.buildReport({ seed, maxDay: 30, actions }, Game, SaveSystem);
  assert.equal(report.investmentCosts.total, 0);
  assert.equal(report.realizedAfterTransport, report.stats.realizedProfit - report.stats.transportCost);
  assert.equal(report.realizedAfterExpenses, report.realizedAfterTransport);
  assert.equal(report.finalAssets - report.startingAssets, report.netAssetsChange);
});

console.log('\nAll Merchant Globe play report tests passed.');
