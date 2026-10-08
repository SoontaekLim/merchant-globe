const assert = require('node:assert/strict');
const { Game, CITIES } = require('../game-core.js');

test('부산-후쿠오카 인삼의 구조적 가격차는 완화된 0.4 밸런스를 사용한다', () => {
  assert.equal(CITIES.busan.modifiers.ginseng, 0.94);
  assert.equal(CITIES.fukuoka.modifiers.ginseng, 1.22);
  assert.equal(CITIES.fukuoka.consumption.ginseng, 1.22);

  const busanBase = 1900 * CITIES.busan.modifiers.ginseng;
  const fukuokaBase = 1900 * CITIES.fukuoka.modifiers.ginseng;
  assert.ok(fukuokaBase - busanBase < 600);
});

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
}

test('매입 시 현금이 감소하고 플레이어 재고가 증가한다', () => {
  const game = new Game({ seed: 'buy-test' });
  const beforeCash = game.cash;
  const result = game.buy('rice', 2);
  assert.equal(game.inventory.rice.qty, 2);
  assert.equal(game.cash, beforeCash - result.total);
});

test('화물 적재량을 초과하면 매입할 수 없다', () => {
  const game = new Game({ seed: 'cargo-test' });
  game.cash = 1_000_000;
  assert.throws(() => game.buy('rice', 21), /화물칸/);
});

test('시장 재고보다 많은 수량은 매입할 수 없다', () => {
  const game = new Game({ seed: 'market-stock-limit' });
  game.cash = 1_000_000;
  game.marketDynamics.seoul.rice.stock = 3;
  assert.throws(() => game.buy('rice', 4), /시장 재고/);
});

test('대량 매입은 현지 재고를 줄이고 다음 시세를 올린다', () => {
  const game = new Game({ seed: 'stock-impact-buy' });
  game.cash = 1_000_000;
  game.capacity = 100;
  const before = game.marketInfo('seoul', 'rice');
  const result = game.buy('rice', 15);
  const after = game.marketInfo('seoul', 'rice');
  assert.equal(after.stock, before.stock - 15);
  assert.ok(result.nextPrice >= result.unitPrice, `${result.nextPrice} >= ${result.unitPrice}`);
});

test('판매는 현지 재고를 늘리고 다음 시세를 낮춘다', () => {
  const game = new Game({ seed: 'stock-impact-sell' });
  game.cash = 1_000_000;
  game.capacity = 100;
  game.buy('tea', 12);
  const beforeSell = game.price('seoul', 'tea');
  const result = game.sell('tea', 12);
  const afterSell = game.price('seoul', 'tea');
  assert.ok(result.stockAfter > 0);
  assert.ok(afterSell <= beforeSell, `${afterSell} <= ${beforeSell}`);
});


test('같은 도시에서 대량 매입 후 즉시 되팔아 자가 펌핑 이익을 만들 수 없다', () => {
  const game = new Game({ seed: 'anti-pump' });
  game.cash = 1_000_000;
  game.capacity = 100;
  const beforeCash = game.cash;
  game.buy('silk', 15);
  game.sell('silk', 15);
  assert.ok(game.cash < beforeCash, `${game.cash} < ${beforeCash}`);
});

test('판매 시 매출과 실현손익이 기록된다', () => {
  const game = new Game({ seed: 'sell-test' });
  game.cash = 1_000_000;
  game.buy('tea', 3);
  const cashAfterBuy = game.cash;
  const result = game.sell('tea', 2);
  assert.equal(game.inventory.tea.qty, 1);
  assert.equal(game.cash, cashAfterBuy + result.revenue);
  assert.equal(game.stats.sells, 1);
  assert.equal(game.stats.unitsSold, 2);
});

test('시간이 지나면 극단적으로 부족한 재고가 평시 수준을 향해 회복된다', () => {
  const game = new Game({ seed: 'stock-recovery' });
  const state = game.marketDynamics.busan.fish;
  state.stock = 1;
  const before = state.stock;
  game.advanceEconomy(1);
  assert.ok(state.stock > before, `${state.stock} > ${before}`);
});

test('도시 이동 시 운송비가 차감되고 날짜가 증가한다', () => {
  const game = new Game({ seed: 'travel-test' });
  const before = game.cash;
  const result = game.travel('busan');
  assert.equal(game.cityId, 'busan');
  assert.equal(game.day, 2);
  assert.equal(game.cash, before - result.cost);
  assert.equal(game.stats.trips, 1);
});

test('화물칸 업그레이드는 용량을 5칸 늘린다', () => {
  const game = new Game({ seed: 'upgrade-test' });
  game.cash = 100_000;
  const result = game.upgradeCargo();
  assert.equal(result.capacity, 25);
  assert.equal(game.capacity, 25);
});


test('현재 도시는 항상 12개 상품의 실시간 시장 정보를 제공한다', () => {
  const game = new Game({ seed: 'intel-local' });
  const intel = game.remoteIntel('seoul');
  assert.equal(intel.live, true);
  assert.equal(intel.entries.length, 12);
  assert.ok(intel.entries.every((entry) => entry.age === 0));
});

test('방문하지 않은 원격 도시는 정보망 없이 시세를 알 수 없다', () => {
  const game = new Game({ seed: 'intel-hidden' });
  const intel = game.remoteIntel('shanghai');
  assert.equal(game.intelLevel, 0);
  assert.equal(intel.entries.length, 0);
});

test('방문한 도시는 마지막 방문 시점의 시세 기록을 남긴다', () => {
  const game = new Game({ seed: 'intel-visited' });
  game.cash = 100_000;
  game.travel('busan');
  const intel = game.remoteIntel('seoul');
  assert.equal(intel.live, false);
  assert.equal(intel.entries.length, 12);
  assert.ok(intel.entries.every((entry) => entry.age >= 1));
});

test('정보망 1단계는 원격 도시별 핵심 상품 3개의 정보를 제공한다', () => {
  const game = new Game({ seed: 'intel-level-one' });
  game.cash = 100_000;
  const result = game.upgradeIntel();
  assert.equal(result.level, 1);
  const intel = game.remoteIntel('shanghai');
  assert.equal(intel.entries.length, 3);
  assert.ok(intel.entries.every((entry) => entry.age === 0));
});

test('낮은 단계 정보망의 원격 시세는 시간이 지나며 낡고 주기적으로 갱신된다', () => {
  const game = new Game({ seed: 'intel-stale' });
  game.cash = 100_000;
  game.upgradeIntel();
  const initial = game.remoteIntel('shanghai').entries.map((entry) => entry.capturedDay);
  game.advanceEconomy(2);
  const stale = game.remoteIntel('shanghai').entries;
  assert.ok(stale.every((entry) => entry.age === 2));
  game.advanceEconomy(1);
  const refreshed = game.remoteIntel('shanghai').entries;
  assert.ok(refreshed.every((entry) => entry.age === 0));
  assert.ok(refreshed.every((entry, i) => entry.capturedDay > initial[i]));
});

test('정보망이 없으면 원격 시장 사건은 정확한 영향과 종료일이 숨겨진다', () => {
  const game = new Game({ seed: 'intel-rumor' });
  const event = game.createEvent();
  if (event.cityId === game.cityId) event.cityId = 'shanghai';
  const rumor = game.marketRumors().find((row) => row.id === event.id);
  assert.equal(rumor.precision, 'rumor');
  assert.equal(rumor.impact, null);
  assert.equal(rumor.expiresDay, null);
});


test('도시 생산/소비 특성이 평시 재고와 수요 구조에 반영된다', () => {
  const game = new Game({ seed: 'city-profile' });
  const shanghaiTea = game.marketDynamics.shanghai.tea;
  const seoulSpice = game.marketDynamics.seoul.spice;
  assert.ok(shanghaiTea.productionFactor > 1);
  assert.ok(seoulSpice.consumptionFactor > 1);
  assert.ok(shanghaiTea.targetStock > 80);
  assert.ok(seoulSpice.targetDemand > 120);
});

test('중량품은 개당 화물칸을 2칸 사용한다', () => {
  const game = new Game({ seed: 'bulky-cargo' });
  game.cash = 1_000_000;
  game.marketDynamics.seoul.iron.stock = 100;
  assert.throws(() => game.buy('iron', 11), /22칸/);
  game.buy('iron', 10);
  assert.equal(game.cargoUsed(), 20);
});

test('수산물은 시간이 지나면 신선도가 하락한다', () => {
  const game = new Game({ seed: 'freshness-decay' });
  game.cash = 100_000;
  game.buy('fish', 3);
  const before = game.inventory.fish.freshness;
  game.advanceEconomy(2);
  const after = game.inventory.fish.freshness;
  assert.ok(after < before, `${after} < ${before}`);
  assert.ok(game.freshnessMultiplier('fish') < 1);
});

test('새 수산물을 추가 매입하면 평균 신선도가 일부 회복된다', () => {
  const game = new Game({ seed: 'freshness-blend' });
  game.cash = 100_000;
  game.buy('fish', 2);
  game.advanceEconomy(2);
  const stale = game.inventory.fish.freshness;
  game.buy('fish', 2);
  assert.ok(game.inventory.fish.freshness > stale);
  assert.ok(game.inventory.fish.freshness < 1);
});

test('공급 차질 이벤트는 시장 재고를 직접 줄인다', () => {
  const game = new Game({ seed: 'shortage-event' });
  const event = game.createEvent('shortage');
  assert.equal(event.kind, 'shortage');
  assert.equal(event.scenario, 'shortage');
  assert.ok(event.impact < 0);
  assert.ok(game.marketDynamics[event.cityId][event.productId].stock >= 1);
});

test('항로 혼잡은 운송비와 이동 시간을 증가시킨다', () => {
  const game = new Game({ seed: 'route-congestion' });
  game.createRouteEvent({ from: 'seoul', to: 'busan', kind: 'congestion' });
  const route = game.routeInfo('seoul', 'busan');
  assert.equal(route.baseCost, 380);
  assert.equal(route.baseDays, 1);
  assert.equal(route.cost, 480);
  assert.equal(route.days, 2);
  assert.equal(route.events.length, 1);
});

test('순풍은 1일 항로를 0일로 만들지 않는다', () => {
  const game = new Game({ seed: 'route-tailwind' });
  game.createRouteEvent({ from: 'seoul', to: 'busan', kind: 'tailwind' });
  const route = game.routeInfo('seoul', 'busan');
  assert.equal(route.days, 1);
  assert.ok(route.cost < route.baseCost);
});

test('이동은 현재 항로 상태의 실제 비용과 시간을 사용한다', () => {
  const game = new Game({ seed: 'route-travel' });
  game.cash = 100_000;
  game.createRouteEvent({ from: 'seoul', to: 'busan', kind: 'congestion' });
  const before = game.cash;
  const result = game.travel('busan');
  assert.equal(result.cost, 480);
  assert.equal(result.days, 2);
  assert.equal(game.day, 3);
  assert.equal(game.cash, before - 480);
});

console.log('\nAll Merchant Globe core tests passed.');
