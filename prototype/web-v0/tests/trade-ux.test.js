'use strict';

const assert = require('node:assert/strict');
const { Game } = require('../game-core.js');
const SaveSystem = require('../save-system.js');
const TradeUX = require('../trade-ux.js');

function test(name, fn) {
  try {
    fn();
    console.log('✓ ' + name);
  } catch (error) {
    console.error('✗ ' + name);
    throw error;
  }
}

test('거래 수량은 유효한 정수로 정규화된다', () => {
  assert.equal(TradeUX.normalizeQuantity('5'), 5);
  assert.equal(TradeUX.normalizeQuantity(5.9), 5);
  assert.equal(TradeUX.normalizeQuantity(''), 1);
  assert.equal(TradeUX.normalizeQuantity(-10), 1);
  assert.equal(TradeUX.normalizeQuantity(Infinity), 1);
  assert.equal(TradeUX.normalizeQuantity('99999'), 9999);
});

test('매입/판매 미리보기는 실제 체결단가와 금액을 사용한다', () => {
  const game = new Game({ seed: 'quote-parity' });
  const before = game.snapshot();
  const info = TradeUX.quote(game, 'rice', 5);
  assert.equal(info.quantity, 5);
  assert.equal(info.buy.allowed, true);
  assert.equal(info.buy.unitPrice, game.executionPrice(game.cityId, 'rice', 5, 'buy'));
  const buy = game.buy('rice', 5);
  assert.equal(info.buy.total, buy.total);
  const sellQuote = TradeUX.quote(game, 'rice', 5);
  assert.equal(sellQuote.sell.allowed, true);
  const sell = game.sell('rice', 5);
  assert.equal(sellQuote.sell.revenue, sell.revenue);
  assert.equal(sellQuote.sell.profit, sell.profit);
  assert.equal(before.cash, 10000);
});

test('최대 매입은 체결 가격 충격과 현금 잔고를 함께 고려한다', () => {
  const game = new Game({ seed: 'cash-limited-buy' });
  game.cash = 3100;
  const report = TradeUX.quote(game, 'rice', 99);
  const max = report.buy.maxQuantity;
  assert.ok(max >= 1);
  assert.ok(max < 20);
  assert.ok(game.executionPrice(game.cityId, 'rice', max, 'buy') * max <= game.cash);
  if (max < game.marketInfo(game.cityId, 'rice').stock) {
    assert.ok(game.executionPrice(game.cityId, 'rice', max + 1, 'buy') * (max + 1) > game.cash);
  }
  assert.equal(report.buy.allowed, false);
  const result = game.buy('rice', max);
  assert.equal(result.qty, max);
});

test('중량품의 최대 매입은 실제 남은 화물칸을 기준으로 한다', () => {
  const game = new Game({ seed: 'cargo-limited-buy' });
  game.cash = 1000000;
  game.capacity = 5;
  const quote = TradeUX.quote(game, 'ceramic', 5);
  assert.equal(quote.buy.maxQuantity, 2);
  assert.equal(quote.buy.allowed, false);
  assert.equal(game.buy('ceramic', quote.buy.maxQuantity).qty, 2);
  assert.equal(TradeUX.quote(game, 'ceramic', 1).buy.maxQuantity, 0);
});

test('시장 재고가 없거나 보유량이 없으면 해당 거래를 제한한다', () => {
  const game = new Game({ seed: 'empty-market-constraints' });
  game.getMarketState('seoul', 'tea').stock = 0;
  assert.equal(TradeUX.quote(game, 'tea', 1).buy.maxQuantity, 0);
  assert.equal(TradeUX.quote(game, 'tea', 1).buy.reason, '시장 재고 없음');
  assert.equal(TradeUX.quote(game, 'tea', 1).sell.allowed, false);
  assert.equal(TradeUX.quote(game, 'tea', 1).sell.maxQuantity, 0);
});

test('전량 판매는 재고만큼 한 번에 체결된다', () => {
  const game = new Game({ seed: 'sell-all' });
  game.buy('rice', 7);
  const q = TradeUX.quote(game, 'rice', 1);
  assert.equal(q.sell.maxQuantity, 7);
  const all = TradeUX.quote(game, 'rice', q.sell.maxQuantity);
  const result = game.sell('rice', all.sell.maxQuantity);
  assert.equal(result.revenue, all.sell.revenue);
  assert.equal(result.profit, all.sell.profit);
  assert.equal(game.inventory.rice.qty, 0);
});

test('미리보기는 게임 상태를 변경하지 않는다', () => {
  const game = new Game({ seed: 'quote-no-mutation' });
  const state = game.snapshot();
  for (let count = 1; count <= 30; count++) {
    TradeUX.quote(game, 'ginseng', count);
    TradeUX.quote(game, 'ceramic', count);
  }
  assert.deepEqual(game.snapshot(), state);
});

test('대량 매입과 전량 판매도 기존 저장 재생과 호환된다', () => {
  const seed = 'bulk-replay';
  const actions = [
    { type: 'buy', productId: 'rice', qty: 5 },
    { type: 'travel', destinationId: 'busan' },
    { type: 'sell', productId: 'rice', qty: 5 }
  ];
  const original = new Game({ seed });
  actions.forEach((action) => SaveSystem.applyAction(original, action));
  const payload = SaveSystem.createSavePayload({ seed, maxDay: 30, actions });
  const restored = SaveSystem.restoreGame(payload, Game);
  assert.deepEqual(restored.game.snapshot(), original.snapshot());
});

test('거래 입력 방식은 1·5·10개, 직접 입력, 최대 매입, 전량 판매를 구분한다', () => {
  const actions = [
    { type: 'buy', productId: 'rice', qty: 10 },
    { type: 'buy', productId: 'tea', qty: 3 },
    { type: 'sell', productId: 'rice', qty: 10 },
    { type: 'buy', productId: 'ginseng', qty: 5 },
    { type: 'sell', productId: 'ginseng', qty: 5 }
  ];
  const modes = ['preset_10', 'custom', 'sell_all', 'max_buy', 'preset_5'];
  const entries = actions.map((action, i) => TradeUX.createControlEntry({
    actionIndex: i + 1, day: 1, cityId: 'seoul',
    side: action.type, productId: action.productId, quantity: action.qty, control: modes[i]
  }));
  const summary = TradeUX.summarizeControls(actions, entries);
  assert.equal(summary.totalTrades, 5);
  assert.equal(summary.trackedTrades, 5);
  assert.equal(summary.untrackedTrades, 0);
  for (const mode of modes) assert.equal(summary.counts[mode], 1);
  assert.equal(summary.counts.preset_1, 0);
});

test('과거 저장 거래는 사용 버튼을 추측하지 않고 미분류로 집계한다', () => {
  const actions = [
    { type: 'buy', productId: 'rice', qty: 5 },
    { type: 'travel', destinationId: 'busan' },
    { type: 'sell', productId: 'rice', qty: 5 }
  ];
  const entry = TradeUX.createControlEntry({
    actionIndex: 3, day: 2, cityId: 'busan',
    side: 'sell', productId: 'rice', quantity: 5, control: 'sell_all'
  });
  const summary = TradeUX.summarizeControls(actions, [entry]);
  assert.equal(summary.totalTrades, 2);
  assert.equal(summary.trackedTrades, 1);
  assert.equal(summary.untrackedTrades, 1);
  assert.equal(summary.counts.sell_all, 1);
});

test('거래 입력 기록의 중복·변조·잘못된 행동 위치는 집계하지 않는다', () => {
  const actions = [{ type: 'buy', productId: 'tea', qty: 10 }];
  const good = TradeUX.createControlEntry({
    actionIndex: 1, day: 1, cityId: 'seoul', side: 'buy',
    productId: 'tea', quantity: 10, control: 'preset_10'
  });
  const summary = TradeUX.summarizeControls(actions, [
    { ...good, actionIndex: 999 },
    { ...good, quantity: 5 },
    { ...good, side: 'sell' },
    good,
    { ...good, control: 'max_buy' },
    good
  ]);
  assert.equal(summary.trackedTrades, 1);
  assert.equal(summary.entries[0].control, 'preset_10');
  assert.equal(summary.counts.preset_10, 1);
  assert.equal(summary.untrackedTrades, 0);

  assert.throws(() => TradeUX.createControlEntry({ ...good, control: 'not_known' }));
  assert.throws(() => TradeUX.createControlEntry({ ...good, control: 'sell_all' }));
});

console.log('\nAll Merchant Globe trade UX tests passed.');
