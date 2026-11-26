'use strict';
const assert = require('node:assert/strict');
const { Game, CITIES, PRODUCTS } = require('../game-core.js');
const TradeUX = require('../trade-ux.js');
const { compare } = require('../remote-comparison.js');

function test(name, fn) { fn(); console.log('✓ ' + name); }
const ids = Object.keys(CITIES);
const make = () => new Game({seed: 123, maxDay: 100});
const run = (game, product = 'rice', qty = 1, mode = 'buy') => compare(game, ids, product, qty, mode, TradeUX);
function row(result, id = 'busan') { return result.rows.find(r => r.cityId === id); }
function observe(game, city = 'busan', product = 'rice', price = 1000, day = game.day) {
  game.intelSnapshots[city] = { [product]: {productId: product, price, capturedDay: day, previousPrice: null} };
}

test('미방문 Lv.0 원격 시장은 시세와 손익을 공개하지 않는다', () => {
  const game = make();
  const result = run(game);
  assert.equal(result.rows.length, ids.length - 1);
  assert.ok(result.rows.every(r => r.cityId !== game.cityId && r.observedPrice === null && r.net === null));
});

test('관측 기록만 사용하고 원격 실제 시장 조회를 호출하지 않는다', () => {
  const game = make();
  game.day = 5;
  observe(game, 'busan', 'rice', 1000, 2);
  const oldMarket = game.marketInfo.bind(game);
  const oldExecution = game.executionPrice.bind(game);
  game.marketInfo = (city, ...args) => { assert.equal(city, game.cityId); return oldMarket(city, ...args); };
  game.executionPrice = (city, ...args) => { assert.equal(city, game.cityId); return oldExecution(city, ...args); };
  const result = run(game);
  const dest = row(result);
  assert.equal(dest.observedPrice, 1000);
  assert.equal(dest.age, 3);
  assert.equal(dest.arrivalAge, 3 + dest.days);
  assert.equal(dest.revenue, 990);
  assert.equal(dest.net, dest.revenue - result.basis - dest.cost);
  assert.equal(dest.netPerDay, dest.net / dest.days);
});

test('정보망에 포함된 상품만 비교에 표시한다', () => {
  const game = make();
  game.upgradeIntel();
  for (const product of PRODUCTS) {
    for (const dest of run(game, product.id).rows) {
      const known = game.remoteIntel(dest.cityId).entries.some(x => x.productId === (product.id));
      assert.equal(dest.observedPrice !== null, known);
    }
  }
});

test('수량에 따른 실제 현지 매입 견적과 편도 비용을 적용한다', () => {
  const game = make();
  observe(game, 'busan', 'rice', 1500);
  const result = run(game, 'rice', 5);
  assert.equal(result.basis, TradeUX.quote(game, 'rice', 5).buy.total);
  assert.equal(row(result).cost, game.routeInfo(game.cityId, 'busan').cost);
  assert.equal(row(result).net, row(result).revenue - result.basis - row(result).cost);
});

test('매입 또는 운송비가 부족하면 손익을 표시하지 않는다', () => {
  const game = make();
  observe(game);
  game.cash = TradeUX.quote(game, 'rice', 1).buy.total;
  assert.equal(row(run(game)).affordable, false);
  assert.equal(row(run(game)).net, null);
  const tooMuch = run(game, 'rice', 9999);
  assert.equal(tooMuch.basis, null);
  assert.equal(row(tooMuch).net, null);
});

test('보유 화물 평균 매입가 및 보유량 제한을 반영한다', () => {
  const game = make();
  game.buy('rice', 2);
  observe(game);
  const result = run(game, 'rice', 2, 'held');
  assert.equal(result.basis, game.inventory.rice.avgCost * 2);
  assert.equal(row(result).net, row(result).revenue - result.basis - row(result).cost);
  assert.equal(run(game, 'rice', 3, 'held').basis, null);
});

test('신선품은 보유 또는 신규 혼합 신선도 및 이동일을 적용한다', () => {
  const game = make();
  game.buy('fish', 2);
  game.inventory.fish.freshness = 0.7;
  observe(game, 'busan', 'fish', 1000);
  const held = row(run(game, 'fish', 2, 'held'));
  const bought = row(run(game, 'fish', 2, 'buy'));
  assert.ok(Math.abs(held.quality - Math.max(0.55, 0.7 - 0.07 * held.days)) < 1e-9);
  assert.ok(Math.abs(bought.quality - Math.max(0.55, 0.85 - 0.07 * bought.days)) < 1e-9);
  assert.ok(held.revenue < bought.revenue);
});

test('비교를 반복해도 경제 상태와 저장에 필요한 기록을 바꾸지 않는다', () => {
  const game = make();
  observe(game);
  const before = JSON.stringify(game);
  run(game); run(game, 'rice', 1, 'held');
  assert.equal(JSON.stringify(game), before);
});

test('항로 혼잡 시 현재 비용 및 시간이 비교에 반영된다', () => {
  const game = make();
  observe(game, 'busan', 'rice', 3000);
  const base = row(run(game));
  game.routeEvents.push({routeKey: game.routeKey('seoul', 'busan'), expiresDay: game.day + 2, costMultiplier: 1.5, daysDelta: 1});
  const crowded = row(run(game));
  assert.equal(crowded.cost, Math.round(base.cost * 1.5 / 10) * 10);
  assert.equal(crowded.days, base.days + 1);
  assert.equal(crowded.net, base.net - (crowded.cost - base.cost));
  assert.equal(crowded.arrivalAge, base.arrivalAge + 1);
});
