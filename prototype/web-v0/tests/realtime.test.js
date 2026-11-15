'use strict';

const assert = require('node:assert/strict');
const { Game } = require('../game-core.js');
const Save = require('../save-system.js');
const RT = require('../realtime-core.js');
const Session = RT.RealtimeSession;

function test(name, fn) {
  try { fn(); console.log('✓ ' + name); }
  catch (error) { console.error('✗ ' + name); throw error; }
}

function create(seed, speed = 1000) {
  return new Session({ GameClass: Game, seed, startedAtMs: 100000, msPerDay: speed });
}

test('실시간 게임은 30일 제한 없이 거래와 경제 갱신을 지속한다', () => {
  const session = create('endless-days');
  assert.equal(session.game.day, 1);
  assert.equal(session.game.gameOver, false);
  session.advanceTo(100000 + 90 * 1000);
  assert.equal(session.game.day, 91);
  assert.equal(session.game.gameOver, false);
  const result = session.perform('buy', { productId: 'paper', qty: 1 }, session.nowMs);
  assert.equal(result.qty, 1);
});

test('아무 거래나 이동 없이 시계가 흐르면 경제 가격과 신선도가 자동 갱신된다', () => {
  const s = create('clock-economy');
  s.perform('buy', { productId: 'fish', qty: 5 }, 100000);
  const before = s.game.market.seoul.tea;
  const originalFreshness = s.game.inventory.fish.freshness;
  const response = s.advanceTo(105500);
  assert.equal(response.ticks, 5);
  assert.equal(s.game.day, 6);
  assert.notEqual(s.game.market.seoul.tea, before);
  assert.ok(s.game.inventory.fish.freshness < originalFreshness);
  assert.equal(s.actions.length, 1);
});

test('운송비는 출발 때 한 번만 차감하고 실제 시각이 되어야 도착한다', () => {
  const s = create('delayed-travel', 1000);
  const route = s.game.routeInfo('seoul', 'busan');
  const beforeCash = s.game.cash;
  const trip = s.perform('startTravel', { destinationId: 'busan' }, 100250);
  assert.equal(s.game.cash, beforeCash - route.cost);
  assert.equal(s.game.stats.transportCost, route.cost);
  assert.equal(trip.arriveAtMs, 100250 + route.days * 1000);
  assert.equal(s.game.cityId, 'seoul');
  s.advanceTo(trip.arriveAtMs - 1);
  assert.equal(s.game.cityId, 'seoul');
  assert.ok(s.transit);
  assert.throws(() => s.perform('buy', { productId: 'rice', qty: 1 }, s.nowMs), /운송 중/);
  assert.throws(() => s.perform('startTravel', { destinationId: 'osaka' }, s.nowMs), /운송 중/);
  const arrival = s.advanceTo(trip.arriveAtMs);
  assert.equal(arrival.arrived, true);
  assert.equal(s.game.cityId, 'busan');
  assert.equal(s.transit, null);
  assert.equal(s.game.stats.trips, 1);
  assert.equal(s.game.stats.transportCost, route.cost);
  s.advanceTo(trip.arriveAtMs + 5000);
  assert.equal(s.game.stats.transportCost, route.cost);
  assert.equal(s.game.gameOver, false);
});

test('운송 중 오프라인 상태로 도착하면 도착 전후의 경제 시간이 올바르게 반영된다', () => {
  const s = create('offline-arrival', 1000);
  s.perform('buy', { productId: 'fish', qty: 3 }, 100000);
  const trip = s.perform('startTravel', { destinationId: 'shanghai' }, 100500);
  const later = trip.arriveAtMs + 7000;
  const restored = RT.restoreSave(s.toSave(), Game, later);
  const direct = s.advanceTo(later);
  assert.equal(direct.arrived, true);
  assert.equal(restored.game.cityId, 'shanghai');
  assert.equal(restored.game.day, s.game.day);
  assert.equal(restored.transit, null);
  assert.deepEqual(restored.game.snapshot(), s.game.snapshot());
});

test('동일한 시드·시간·행동으로 복구하면 가격과 이후 이벤트가 완전히 동일하다', () => {
  const s = create('deterministic-wallclock');
  s.perform('buy', { productId: 'paper', qty: 5, surface: 'market' }, 100010);
  s.advanceTo(102000);
  s.perform('startTravel', { destinationId: 'busan' }, 102200);
  s.advanceTo(106000);
  s.perform('sell', { productId: 'paper', qty: 5, surface: 'cargo' }, 106050);
  s.perform('upgradeIntel', {}, 107000);
  const r = RT.restoreSave(s.toSave(), Game, s.nowMs);
  assert.deepEqual(r.game.snapshot(), s.game.snapshot());
  assert.deepEqual(r.actions, s.actions);
  s.advanceTo(125000);
  r.advanceTo(125000);
  assert.deepEqual(r.game.snapshot(), s.game.snapshot());
  assert.equal(r.game.gameOver, false);
});

test('같은 게임 시각의 매매는 날짜를 추가로 진행시키지 않는다', () => {
  const s = create('actions-no-turns');
  const initialDay = s.game.day;
  const bought = s.perform('buy', { productId: 'paper', qty: 2 }, 100300);
  const sold = s.perform('sell', { productId: 'paper', qty: 2 }, 100301);
  assert.ok(bought.total > 0);
  assert.ok(sold.revenue > 0);
  assert.equal(s.game.day, initialDay);
  assert.equal(s.actions.length, 2);
});

test('시계가 거꾸로 조작되어도 게임 시간은 되돌아가지 않는다', () => {
  const s = create('rollback-protection');
  s.advanceTo(105000);
  const state = s.game.snapshot();
  const observed = s.nowMs;
  const response = s.advanceTo(102000);
  assert.equal(response.ticks, 0);
  assert.equal(s.nowMs, observed);
  assert.deepEqual(s.game.snapshot(), state);
  const save = s.toSave();
  const restored = RT.restoreSave(save, Game, 102000);
  assert.equal(restored.nowMs, observed);
  assert.deepEqual(restored.game.snapshot(), state);
});

test('현재 항로 이벤트의 고정된 출발 비용·기간을 운송 시작 시에 저장한다', () => {
  const s = create('route-snapshot');
  const key = s.game.routeKey('seoul', 'busan');
  // Modifying live route events directly is intentionally limited to this unit test.
  s.game.routeEvents.push({
    id: 'forced-route-event', type: 'route', kind: 'congestion', routeKey: key,
    from: 'seoul', to: 'busan', costMultiplier: 1.25, daysDelta: 1,
    createdDay: 1, expiresDay: 2
  });
  const route = s.game.routeInfo('seoul', 'busan');
  const trip = s.perform('startTravel', { destinationId: 'busan' }, 100001);
  assert.equal(trip.days, route.days);
  assert.equal(trip.cost, route.cost);
  s.advanceTo(101999);
  assert.equal(s.game.cityId, 'seoul');
  assert.equal(s.transit.arriveAtMs, trip.arriveAtMs);
  s.advanceTo(trip.arriveAtMs);
  assert.equal(s.game.cityId, 'busan');
});

test('무효한 저장 기록과 미지원 행동은 거부되며 기존 30일 저장 버전은 유지된다', () => {
  const s = create('validations');
  assert.throws(() => s.perform('buy', { productId: 'rice', qty: -2 }, 100000), /수량/);
  assert.throws(() => s.perform('wait', {}, 100000), /지원하지/);
  assert.throws(() => s.perform('startTravel', { destinationId: 'seoul' }, 100000), /이동할 수 없는/);
  const corrupted = { ...s.toSave(), actions: [{ type: 'buy', atMs: 100000, productId: 'rice', qty: 0 }] };
  assert.throws(() => RT.restoreSave(corrupted, Game, 100000), /수량/);
  assert.equal(Save.GAME_VERSION, '0.4.0');
  const classic = Save.createSavePayload({ seed: 12345, maxDay: 30, actions: [] });
  assert.equal(Save.restoreGame(classic, Game).game.maxDay, 30);
  assert.throws(() => Save.validateSave(s.toSave()), /호환되지 않는 저장 데이터/);
});

test('대량 오프라인 복구 제한은 무한 반복을 방지한다', () => {
  const s = create('catchup-limit', 1000);
  assert.throws(() => s.advanceTo(100000 + 100001000), /오프라인 경과/);
  assert.equal(s.game.day, 1);
});

test('진행 중 속도 변경은 현재 경제 날짜를 유지하고 하루의 남은 비율만 단축한다', () => {
  const s = create('instant-speed-switch', 60000);
  s.advanceTo(130000); // First day is half elapsed at 60 s/day.
  assert.equal(s.game.day, 1);
  assert.equal(s.nextTickAtMs(), 160000);
  const before = s.game.snapshot();
  const changed = s.perform('setSpeed', { msPerDay: 10000 }, 130000);
  assert.deepEqual(changed, { oldMsPerDay: 60000, msPerDay: 10000 });
  assert.equal(s.nextTickAtMs(), 135000);
  assert.equal(s.game.day, 1);
  assert.deepEqual(s.game.snapshot(), before);
  assert.equal(s.toSave().msPerDay, 60000);
  assert.equal(s.toSave().activeMsPerDay, 10000);
  s.advanceTo(134999);
  assert.equal(s.game.day, 1);
  s.advanceTo(135000);
  assert.equal(s.game.day, 2);
  s.advanceTo(145000);
  assert.equal(s.game.day, 3);
  const restored = RT.restoreSave(s.toSave(), Game, s.nowMs);
  assert.equal(restored.msPerDay, 10000);
  assert.equal(restored.nextTickAtMs(), s.nextTickAtMs());
  assert.deepEqual(restored.game.snapshot(), s.game.snapshot());
});

test('운송 중 테스트 가속 변경은 남은 운송 시간과 경제 시계를 함께 단축한다', () => {
  const s = create('accelerate-in-transit', 60000);
  const cost = s.game.routeInfo('seoul', 'fukuoka').cost;
  const original = s.perform('startTravel', { destinationId: 'fukuoka' }, 100000);
  const originalCash = s.game.cash;
  const originalArrival = original.arriveAtMs;
  s.advanceTo(130000);
  const remaining = s.remainingMs();
  const changed = s.perform('setSpeed', { msPerDay: 10000 }, 130000);
  assert.equal(changed.msPerDay, 10000);
  const rescaledRemaining = Math.ceil(remaining / 6);
  assert.equal(s.remainingMs(), rescaledRemaining);
  assert.equal(s.transit.arriveAtMs, 130000 + rescaledRemaining);
  assert.ok(s.transit.arriveAtMs < originalArrival);
  assert.equal(s.game.cash, originalCash);
  assert.equal(s.game.stats.transportCost, cost);
  const saved = s.toSave();
  const restored = RT.restoreSave(saved, Game, s.nowMs);
  assert.deepEqual(restored.transit, s.transit);
  assert.deepEqual(restored.game.snapshot(), s.game.snapshot());

  const arrival = s.transit.arriveAtMs;
  s.advanceTo(arrival - 1);
  assert.ok(s.transit, 'Voyage should remain in transit until revised arrival time');
  const result = s.advanceTo(arrival);
  assert.equal(result.arrived, true);
  assert.equal(s.game.cityId, 'fukuoka');
  assert.equal(s.game.stats.transportCost, cost);
  restored.advanceTo(arrival);
  assert.deepEqual(restored.game.snapshot(), s.game.snapshot());
  assert.equal(restored.transit, null);
});

test('여러 번 변경한 속도는 저장 복원 후 같은 날짜·현금·가격·미래 이벤트를 만든다', () => {
  const s = create('multiple-speed-changes', 60000);
  s.perform('buy', { productId: 'rice', qty: 3 }, 100020);
  s.perform('setSpeed', { msPerDay: 10000 }, 132000);
  s.advanceTo(142000);
  s.perform('setSpeed', { msPerDay: 60000 }, 144000);
  s.perform('startTravel', { destinationId: 'busan' }, 147000);
  s.perform('setSpeed', { msPerDay: 10000 }, 153000);
  s.advanceTo(s.transit.arriveAtMs + 22000);
  const restored = RT.restoreSave(s.toSave(), Game, s.nowMs);
  assert.deepEqual(restored.game.snapshot(), s.game.snapshot());
  assert.equal(restored.msPerDay, s.msPerDay);
  assert.equal(restored.nextTickAtMs(), s.nextTickAtMs());
  assert.deepEqual(restored.actions, s.actions);
  restored.advanceTo(s.nowMs + 50000);
  s.advanceTo(s.nowMs + 50000);
  assert.deepEqual(restored.game.snapshot(), s.game.snapshot());
});

test('기존 0.6 저장도 현재 속도 추가 필드 없이 복원되며 잘못된 속도 기록은 거부된다', () => {
  const original = create('legacy-realtime-save', 60000);
  original.advanceTo(200000);
  const oldSave = original.toSave();
  delete oldSave.activeMsPerDay;
  const restored = RT.restoreSave(oldSave, Game, 200000);
  assert.deepEqual(restored.game.snapshot(), original.game.snapshot());
  assert.equal(restored.msPerDay, 60000);

  const bad = original.toSave();
  bad.actions.push({ type: 'setSpeed', msPerDay: 0, atMs: 200000 });
  assert.throws(() => RT.restoreSave(bad, Game, 200000), /경제 갱신 간격/);

  const tampered = original.toSave();
  tampered.activeMsPerDay = 10000;
  assert.throws(() => RT.restoreSave(tampered, Game, 200000), /속도 변경 기록/);
});

test('경제 전체 체크포인트는 난수 위치·시장 가격·수산물 신선도를 정확히 복원한다', () => {
  const s = create('snapshot-rng-economy', 1000);
  s.perform('buy', { productId: 'fish', qty: 4 }, 100000);
  s.advanceTo(113200);
  const checkpoint = s.game.exportCheckpoint();
  assert.equal(checkpoint.format, 1);
  assert.ok(Number.isInteger(checkpoint.rngState));
  assert.ok(checkpoint.market.seoul.tea > 0);
  const rebuilt = new Game({ seed: 'snapshot-rng-economy', maxDay: Number.MAX_SAFE_INTEGER });
  rebuilt.restoreCheckpoint(checkpoint);
  assert.deepEqual(rebuilt.snapshot(), s.game.snapshot());
  rebuilt.advanceEconomy(8);
  s.game.advanceEconomy(8);
  assert.deepEqual(rebuilt.snapshot(), s.game.snapshot());
});

test('체크포인트는 오래된 행동을 압축하고 남은 행동과 경제·운송 상태를 복원한다', () => {
  const s = create('checkpoint-action-tail', 1000);
  let totalActions = 0;
  for (let i = 0; i < 70; i++) {
    s.perform('buy', { productId: 'rice', qty: 1 }, 100010 + i * 900);
    s.perform('sell', { productId: 'rice', qty: 1 }, 100015 + i * 900);
    totalActions += 2;
    s.toSave();
  }
  const save = s.toSave();
  assert.ok(save.checkpoint, 'A full checkpoint should have been created');
  assert.ok(save.archivedActionCount >= RT.CHECKPOINT_ACTION_INTERVAL);
  assert.ok(save.actions.length < RT.CHECKPOINT_ACTION_INTERVAL);
  assert.equal(save.archivedActionCount + save.actions.length, totalActions);
  assert.equal(save.checkpoint.archivedActions, save.archivedActionCount);
  assert.ok(JSON.stringify(save).length < 100000, 'Persisted save should be bounded');
  const restored = RT.restoreSave(save, Game, s.nowMs);
  assert.equal(restored.archivedActions, save.archivedActionCount);
  assert.deepEqual(restored.actions, s.actions);
  assert.deepEqual(restored.game.snapshot(), s.game.snapshot());
  s.advanceTo(s.nowMs + 10000);
  restored.advanceTo(s.nowMs);
  assert.deepEqual(restored.game.snapshot(), s.game.snapshot());
});

test('한 달 동안 거래가 없어도 시간 기반 체크포인트로 긴 복원 재생을 줄인다', () => {
  const s = create('checkpoint-clock-only', 1000);
  s.advanceTo(100000 + 90 * 1000);
  const save = s.toSave();
  assert.equal(save.actions.length, 0);
  assert.equal(save.checkpoint.economy.day, 91);
  assert.equal(save.checkpoint.atMs, s.nowMs);
  const restored = RT.restoreSave(save, Game, s.nowMs);
  assert.deepEqual(restored.game.snapshot(), s.game.snapshot());
  restored.advanceTo(s.nowMs + 5000);
  s.advanceTo(s.nowMs + 5000);
  assert.deepEqual(restored.game.snapshot(), s.game.snapshot());
});

test('운송 중 속도 변경과 체크포인트는 재접속 후 정확한 도착시각을 유지한다', () => {
  const s = create('checkpoint-ship-speed', 60000);
  s.perform('buy', { productId: 'paper', qty: 4 }, 100010);
  s.perform('startTravel', { destinationId: 'shanghai' }, 100300);
  s.perform('setSpeed', { msPerDay: 10000 }, 106000);
  s.checkpointNow();
  const save = s.toSave();
  assert.ok(save.checkpoint.transit);
  const r = RT.restoreSave(save, Game, s.nowMs);
  assert.deepEqual(r.transit, s.transit);
  assert.equal(r.msPerDay, 10000);
  const destMs = s.transit.arriveAtMs + 10000;
  s.advanceTo(destMs);
  r.advanceTo(destMs);
  assert.equal(r.game.cityId, 'shanghai');
  assert.deepEqual(r.game.snapshot(), s.game.snapshot());
  assert.equal(r.game.stats.transportCost, s.game.stats.transportCost);
});

test('기간별 실현손익은 매출·운송비·성장 투자비를 정확히 구분하며 저장 복원에도 유지된다', () => {
  const s = create('accounting-profit-daily', 1000);
  s.perform('buy', { productId: 'rice', qty: 2 }, 100010);
  const sold = s.perform('sell', { productId: 'rice', qty: 2 }, 100300);
  s.perform('upgradeIntel', {}, 100400);
  const trip = s.perform('startTravel', { destinationId: 'busan' }, 101000);
  const daily = s.recentPerformance('day', 8);
  const first = daily.find((row) => row.index === 1);
  const second = daily.find((row) => row.index === 2);
  assert.equal(first.realizedProfit, sold.profit);
  assert.equal(first.investmentCost, 6000);
  assert.equal(first.buys, 1);
  assert.equal(first.sells, 1);
  assert.equal(first.netProfit, sold.profit - 6000);
  assert.equal(second.transportCost, trip.cost);
  assert.equal(second.trips, 1);
  assert.equal(second.netProfit, -trip.cost);
  const totals = s.performanceTotals();
  assert.equal(totals.netProfit, sold.profit - 6000 - trip.cost);
  assert.equal(totals.investmentCost, 6000);
  const weekly = s.recentPerformance('week', 8);
  assert.equal(weekly[0].netProfit, totals.netProfit);

  const r = RT.restoreSave(s.toSave(), Game, s.nowMs);
  assert.deepEqual(r.recentPerformance('day', 8), s.recentPerformance('day', 8));
  assert.deepEqual(r.recentPerformance('week', 8), weekly);
  assert.deepEqual(r.performanceTotals(), totals);
});

test('거래가 없는 날은 0원으로 표시하며 주간 집계는 7게임일 단위다', () => {
  const s = create('empty-days-weekly', 1000);
  s.advanceTo(100000 + 15 * 1000); // Day 16, week 3.
  assert.equal(s.game.day, 16);
  const daily = s.recentPerformance('day', 14);
  assert.equal(daily.length, 14);
  assert.equal(daily[0].index, 3);
  assert.equal(daily[daily.length - 1].index, 16);
  assert.ok(daily.every((row) => row.netProfit === 0));
  const weeks = s.recentPerformance('week', 8);
  assert.deepEqual(weeks.map((row) => [row.index, row.startDay, row.endDay]),
    [[1, 1, 7], [2, 8, 14], [3, 15, 21]]);
});

test('체크포인트의 최근 180개 거래일과 52개 거래주 기록만 남긴다', () => {
  const s = create('history-bounded', 1000);
  for (let i = 0; i < 200; i++) {
    s.perform('buy', { productId: 'rice', qty: 1 }, 100000 + i * 7000);
    s.perform('sell', { productId: 'rice', qty: 1 }, 100010 + i * 7000);
    s.toSave();
  }
  assert.ok(s.dailyHistory.length <= RT.DAILY_HISTORY_LIMIT);
  assert.ok(s.weeklyHistory.length <= RT.WEEKLY_HISTORY_LIMIT);
  const save = s.toSave();
  assert.ok(save.checkpoint.dailyHistory.length <= RT.DAILY_HISTORY_LIMIT);
  const restored = RT.restoreSave(save, Game, s.nowMs);
  assert.deepEqual(restored.game.snapshot(), s.game.snapshot());
  assert.deepEqual(restored.performanceTotals(), s.performanceTotals());
});

test('손상된 체크포인트는 잘못된 시장이나 행동을 덮어쓰지 않고 거부한다', () => {
  const s = create('bad-checkpoint', 1000);
  s.advanceTo(130000);
  const save = s.toSave();
  const badMarket = JSON.parse(JSON.stringify(save));
  delete badMarket.checkpoint.economy.market.seoul;
  assert.throws(() => RT.restoreSave(badMarket, Game, s.nowMs), /시장 상태|도시 상태/);
  const missingCheckpoint = JSON.parse(JSON.stringify(save));
  missingCheckpoint.checkpoint = null;
  missingCheckpoint.archivedActionCount = 1;
  assert.throws(() => RT.restoreSave(missingCheckpoint, Game, s.nowMs), /체크포인트/);
  const badHistory = JSON.parse(JSON.stringify(save));
  badHistory.checkpoint.dailyHistory = [{}];
  assert.throws(() => RT.restoreSave(badHistory, Game, s.nowMs), /손익 집계/);
  const badTail = JSON.parse(JSON.stringify(save));
  badTail.actions = [{ type: 'buy', productId: 'rice', qty: 1, atMs: save.checkpoint.atMs - 1 }];
  assert.throws(() => RT.restoreSave(badTail, Game, s.nowMs), /행동 시각/);
});

test('0.6 시드+전체 행동 저장은 체크포인트 없이도 0.6.1에서 복구되고 전환된다', () => {
  const s = create('legacy-v0.6-before-checkpoint', 1000);
  s.perform('buy', { productId: 'ginseng', qty: 2 }, 100020);
  const legacy = s.toSave();
  delete legacy.checkpoint;
  delete legacy.archivedActionCount;
  const restored = RT.restoreSave(legacy, Game, s.nowMs);
  assert.deepEqual(restored.game.snapshot(), s.game.snapshot());
  assert.equal(restored.archivedActions, 0);
  restored.advanceTo(135000);
  const compacted = restored.toSave();
  assert.ok(compacted.checkpoint);
  assert.deepEqual(RT.restoreSave(compacted, Game, restored.nowMs).game.snapshot(), restored.game.snapshot());
});

test('장기간 오프라인 복원은 한 번에 100,000일을 넘겨도 나누어 진행할 수 있다', () => {
  const s = create('very-long-offline-batched', 1000);
  const target = s.nowMs + 100001 * 1000;
  const progress = s.advanceTowards(target, 250);
  assert.equal(progress.ticks, 250);
  assert.equal(progress.complete, false);
  assert.equal(s.game.day, 251);
  const save = s.toSave();
  assert.ok(save.checkpoint);
  const partiallyRestored = RT.restoreSave(save, Game, target, { catchUpTicks: 250 });
  assert.equal(partiallyRestored.game.day, 501);
  assert.ok(partiallyRestored.nowMs < target);
});

test('분할 오프라인 복원과 일괄 복원은 운송 도착 및 이후 경제 난수가 같다', () => {
  const s = create('batched-economy-arrival', 1000);
  s.perform('buy', { productId: 'fish', qty: 3 }, 100010);
  const trip = s.perform('startTravel', { destinationId: 'busan' }, 100200);
  const save = s.toSave();
  const target = 100000 + 2700 * 1000;
  const direct = RT.restoreSave(save, Game, target);
  const bounded = RT.restoreSave(save, Game, target, { catchUpTicks: 250 });
  assert.ok(bounded.nowMs < target);
  let rounds = 1;
  while (bounded.nowMs < target) {
    const result = bounded.advanceTowards(target, 250);
    assert.ok(result.ticks <= 250);
    rounds++;
    assert.ok(rounds < 20);
  }
  assert.ok(rounds > 5);
  assert.ok(trip.arriveAtMs < target);
  assert.equal(bounded.game.cityId, 'busan');
  assert.deepEqual(bounded.game.snapshot(), direct.game.snapshot());
  assert.deepEqual(bounded.recentPerformance('day', 14), direct.recentPerformance('day', 14));
  assert.deepEqual(bounded.transit, direct.transit);
});

test('밀리초 경계에서 속도를 반복 전환해도 갱신과 도착이 밀리지 않는다', () => {
  const s = create('speed-round-trip', 60000);
  s.perform('buy', { productId: 'fish', qty: 2 }, s.nowMs);
  const trip = s.perform('startTravel', { destinationId: 'busan' }, s.nowMs);
  s.perform('setSpeed', { msPerDay: 10000 }, 100001);
  assert.equal(s.nextTickAtMs(), 110001);
  s.checkpointNow();
  const restored = RT.restoreSave(s.toSave(), Game, s.nowMs);
  for (const session of [s, restored]) {
    session.changeSpeed(60000);
    for (let i = 0; i < 10; i++) {
      session.changeSpeed(10000);
      session.changeSpeed(60000);
    }
    assert.equal(session.nextTickAtMs(), trip.arriveAtMs);
    assert.equal(session.transit.arriveAtMs, trip.arriveAtMs);
    assert.equal(session.advanceTo(trip.arriveAtMs - 1).ticks, 0);
    assert.equal(session.game.cityId, 'seoul');
    assert.equal(session.advanceTo(trip.arriveAtMs).arrived, true);
    assert.equal(session.game.day, 2);
    assert.equal(session.game.stats.transportCost, trip.cost);
  }
  assert.deepEqual(s.game.exportCheckpoint(), restored.game.exportCheckpoint());
  assert.deepEqual(RT.restoreSave(s.toSave(), Game, s.nowMs).game.exportCheckpoint(), s.game.exportCheckpoint());
});

test('0.6 저장의 속도 행동은 당시 반올림과 날짜 경계를 재현한다', () => {
  const legacy = {
    schemaVersion: 1, mode: 'realtime', seed: 'legacy-rounded-tick',
    startedAtMs: 100000, observedAtMs: 160000, msPerDay: 60000, activeMsPerDay: 60000,
    actions: [
      { type: 'setSpeed', atMs: 100001, msPerDay: 10000 },
      { type: 'setSpeed', atMs: 100001, msPerDay: 60000 },
      { type: 'buy', atMs: 160000, productId: 'paper', qty: 1 }
    ]
  };
  const s = RT.restoreSave(legacy, Game, legacy.observedAtMs);
  assert.equal(s.game.day, 1);
  assert.equal(s.nextTickAtMs(), 160001);
  assert.equal(s.recentPerformance('day', 1)[0].buys, 1);
  s.advanceTo(160001);
  assert.equal(s.game.day, 2);
});

test('속도 전환으로 가상 시계 기준과 출발 시각이 음수가 되어도 체크포인트를 복원한다', () => {
  const s = new Session({ GameClass: Game, seed: 0, startedAtMs: 0, msPerDay: 10000 });
  s.perform('startTravel', { destinationId: 'busan' }, 0);
  s.perform('setSpeed', { msPerDay: 60000 }, 9001);
  const cp = s.checkpointNow();
  assert.ok(cp.clockEpochMs < 0);
  assert.ok(cp.transit.departedAtMs < 0);
  const restored = RT.restoreSave(s.toSave(), Game, 9001);
  assert.equal(restored.nextTickAtMs(), s.nextTickAtMs());
  assert.deepEqual(restored.transit, s.transit);
  assert.deepEqual(restored.game.exportCheckpoint(), s.game.exportCheckpoint());
});

test('복구의 마지막 경제일 이후 같은 날의 도착도 같은 배치에서 처리한다', () => {
  const s = create('fractional-arrival');
  const trip = s.perform('startTravel', { destinationId: 'busan' }, 100500);
  const progress = s.advanceTowards(trip.arriveAtMs, 1);
  assert.deepEqual(progress, { ticks: 1, arrived: true, nowMs: trip.arriveAtMs, complete: true });
  assert.equal(s.game.cityId, 'busan');
});

test('오프라인 복구 도중 새로고침하거나 시스템 시계가 후퇴해도 복구 목표를 유지한다', () => {
  const s = create('resume-offline-watermark');
  const trip = s.perform('startTravel', { destinationId: 'shanghai' }, 100500);
  const target = trip.arriveAtMs + 8000;
  const direct = RT.restoreSave(s.toSave(), Game, target);
  assert.equal(s.advanceTowards(target, 2).complete, false);
  assert.throws(() => s.perform('setSpeed', { msPerDay: 10000 }, s.nowMs), /복구/);

  const partial = s.toSave();
  assert.equal(partial.recoveryTargetMs, target);
  const restored = RT.restoreSave(partial, Game, 100000, { catchUpTicks: 2 });
  assert.equal(restored.game.cityId, 'shanghai');
  assert.equal(restored.recoveryTargetMs, target);
  for (let i = 0; i < 10 && restored.recoveryTargetMs !== null; i++) restored.advanceTowards(100000, 2);
  assert.equal(restored.nowMs, target);
  assert.equal(restored.toSave().recoveryTargetMs, undefined);
  assert.deepEqual(restored.game.exportCheckpoint(), direct.game.exportCheckpoint());
});

test('체크포인트 없는 0.6 행동 사이에 긴 공백이 있어도 배치 단위로 재생한다', () => {
  const actionAt = 100000 + 100001 * 1000;
  const legacy = {
    schemaVersion: 1, mode: 'realtime', seed: 'legacy-long-action-gap',
    startedAtMs: 100000, observedAtMs: actionAt, msPerDay: 1000,
    actions: [{ type: 'buy', atMs: actionAt, productId: 'rice', qty: 1 }]
  };
  const first = RT.restoreSave(legacy, Game, actionAt, { catchUpTicks: 2 });
  assert.equal(first.game.day, 3);
  assert.equal(first.game.stats.buys, 0);
  assert.deepEqual(first.toSave().actions, legacy.actions);
  assert.equal(first.toSave().observedAtMs, actionAt);

  for (let i = 0; i < 11 && first.recoveryTargetMs !== null; i++) first.advanceTowards(actionAt, 10000);
  assert.equal(first.game.day, 100002);
  assert.equal(first.game.stats.buys, 1);
  assert.equal(first.recentPerformance('day', 1)[0].buys, 1);
  const compacted = first.toSave();
  assert.deepEqual(compacted.actions, []);
  assert.deepEqual(RT.restoreSave(compacted, Game, actionAt).game.exportCheckpoint(), first.game.exportCheckpoint());
});

test('일·주 경계에서 운송비는 출발일에, 판매 손익은 실제 체결일에 한 번씩 기록한다', () => {
  const s = create('week-rounding-0');
  s.perform('buy', { productId: 'paper', qty: 2 }, 100000);
  s.perform('buy', { productId: 'paper', qty: 1 }, 105000);
  const investment = s.perform('upgradeIntel', {}, 106000);
  const firstSale = s.perform('sell', { productId: 'paper', qty: 1 }, 106000);
  const secondSale = s.perform('sell', { productId: 'paper', qty: 1 }, 106100);
  const trip = s.perform('startTravel', { destinationId: 'busan' }, 106999);
  const realized = firstSale.profit + secondSale.profit;
  const net = realized - trip.cost - investment.cost;
  const cp = s.checkpointNow();
  assert.equal(cp.dailyHistory.find((row) => row.index === 7).netProfit, net);
  assert.equal(cp.weeklyHistory[0].netProfit, net);

  // A 0.6.1 checkpoint may contain the previous arithmetic order's rounding error.
  const save = s.toSave();
  const oldNet = -investment.cost + firstSale.profit + secondSale.profit - trip.cost;
  assert.notEqual(oldNet, net);
  save.checkpoint.dailyHistory.find((row) => row.index === 7).netProfit = oldNet;
  save.checkpoint.weeklyHistory[0].netProfit = oldNet;
  const restored = RT.restoreSave(save, Game, 107000);
  assert.throws(() => restored.perform('sell', { productId: 'paper', qty: 1 }, 107000), /운송 중/);
  const lastSale = restored.perform('sell', { productId: 'paper', qty: 1 }, trip.arriveAtMs);
  const daily = restored.recentPerformance('day', 3);
  const day7 = daily.find((row) => row.index === 7);
  const arrivalDay = daily[daily.length - 1];
  const [week1, week2] = restored.recentPerformance('week', 2);
  for (const row of [day7, week1]) {
    assert.equal(row.realizedProfit, realized);
    assert.equal(row.investmentCost, investment.cost);
    assert.equal(row.transportCost, trip.cost);
    assert.equal(row.netProfit, row.realizedProfit - row.transportCost - row.investmentCost);
  }
  for (const row of [arrivalDay, week2]) {
    assert.equal(row.sells, 1);
    assert.equal(row.transportCost, 0);
    assert.equal(row.netProfit, lastSale.profit);
  }
  assert.equal(restored.performanceTotals().transportCost, trip.cost);
});

test('체크포인트 생성 실패 뒤 재시도해도 압축 행동 수는 중복되지 않는다', () => {
  const s = create('checkpoint-retry');
  s.perform('buy', { productId: 'paper', qty: 1 }, s.nowMs);
  const exportCheckpoint = s.game.exportCheckpoint;
  s.game.exportCheckpoint = () => { throw new Error('checkpoint export failed'); };
  assert.throws(() => s.checkpointNow(), /checkpoint export failed/);
  assert.equal(s.archivedActions, 0);
  assert.equal(s.actions.length, 1);
  s.game.exportCheckpoint = exportCheckpoint;
  assert.equal(s.checkpointNow().archivedActions, 1);
  assert.equal(s.actions.length, 0);
});

test('체크포인트의 시계·항로·시장·손익 필드가 손상되면 복원을 중단한다', () => {
  const s = create('malformed-checkpoint');
  s.perform('startTravel', { destinationId: 'busan' }, 100500);
  s.checkpointNow();
  const corruptions = [
    [(cp) => { cp.clockEpochMs -= cp.msPerDay - 1; }, /시계와 경제 날짜/],
    [(cp) => { cp.transit.to = 'constructor'; }, /운송 항로/],
    [(cp) => { delete cp.economy.marketDynamics.seoul.paper.demand; }, /시장 상태/],
    [(cp) => { delete cp.economy.stats.revenue; }, /거래 통계/],
    [(cp) => { cp.economy.rngState = 0; }, /난수 상태/],
    [(cp) => { cp.dailyHistory[0].netProfit = 0; }, /손익 집계 금액/],
    [(cp) => { Object.assign(cp.dailyHistory[0], { index: 2, startDay: 2, endDay: 2 }); }, /손익 집계 기간/]
  ];
  for (const [corrupt, message] of corruptions) {
    const save = s.toSave();
    corrupt(save.checkpoint);
    assert.throws(() => RT.restoreSave(save, Game, s.nowMs), message);
  }
});

console.log('\nAll Merchant Globe realtime tests passed.');
