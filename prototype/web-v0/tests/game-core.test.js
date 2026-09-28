const assert = require('node:assert/strict');
const { Game } = require('../game-core.js');

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

console.log('\nAll Merchant Globe core tests passed.');
