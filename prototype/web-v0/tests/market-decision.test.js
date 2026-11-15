'use strict';

const assert = require('node:assert/strict');
const Decision = require('../market-decision.js');
const { Game } = require('../game-core.js');
const Realtime = require('../realtime-core.js');

function test(name, fn) {
  try { fn(); console.log('✓ ' + name); }
  catch (error) { console.error('✗ ' + name); throw error; }
}

function trend(currentPrice, minPrice, maxPrice, observedDays, previousDayPercent = null) {
  return { currentPrice, minPrice, maxPrice, observedDays, previousDayPercent };
}
function row(id, signal) { return { product: { id }, trend: signal }; }

test('3게임일 미만 관측은 최근 최저권을 단정하지 않는다', () => {
  for (const days of [0, 1, 2]) {
    const result = Decision.signal(trend(100, 90, 110, days));
    assert.equal(result.eligible, false);
    assert.equal(result.position, null);
    assert.match(result.label, /관측 3일 미만/);
  }
  assert.equal(Decision.signal(null).eligible, false);
});

test('최저·중간·최고권은 관측 범위에 대한 상대 위치만 표현한다', () => {
  assert.deepEqual(Decision.signal(trend(90, 90, 110, 4)), {
    eligible: true, position: 0, label: '관측 저가권'
  });
  assert.deepEqual(Decision.signal(trend(100, 90, 110, 4)), {
    eligible: true, position: 50, label: '관측 중간권'
  });
  assert.deepEqual(Decision.signal(trend(110, 90, 110, 4)), {
    eligible: true, position: 100, label: '관측 고가권'
  });
  assert.equal(Decision.signal(trend(95, 90, 110, 3)).label, '관측 저가권');
  assert.equal(Decision.signal(trend(105, 90, 110, 3)).label, '관측 고가권');
});

test('변동 없는 시세는 가격 위치를 정하지 않고 비교 제외한다', () => {
  const flat = Decision.signal(trend(100, 100, 100, 7));
  assert.equal(flat.eligible, false);
  assert.match(flat.label, /관측 시세 동일/);
});

test('관측 저가권 정렬은 표본 부족 상품을 뒤로 보내고 동일 위치는 원래 순서를 유지한다', () => {
  const rows = [
    row('early', trend(100, 90, 110, 4)),
    row('unknown', trend(100, 90, 110, 2)),
    row('cheap-a', trend(90, 90, 110, 4)),
    row('cheap-b', trend(90, 90, 110, 5)),
    row('flat', trend(100, 100, 100, 7)),
    row('high', trend(110, 90, 110, 4))
  ];
  const sorted = Decision.sortRows(rows, 'range-low');
  assert.deepEqual(sorted.map((item) => item.product.id),
    ['cheap-a', 'cheap-b', 'early', 'high', 'unknown', 'flat']);
  assert.deepEqual(rows.map((item) => item.product.id),
    ['early', 'unknown', 'cheap-a', 'cheap-b', 'flat', 'high']);
});

test('전일 하락폭 정렬은 직접 관측한 전일 대비 하락만 비교하고 미관측은 뒤로 보낸다', () => {
  const rows = [
    row('up', trend(100, 80, 120, 2, 10)),
    row('none', trend(100, 80, 120, 5)),
    row('down', trend(80, 80, 110, 2, -20)),
    row('stable', trend(100, 80, 120, 2, 0)),
    row('down-tie', trend(81, 80, 110, 2, -20))
  ];
  const sorted = Decision.sortRows(rows, 'day-drop');
  assert.deepEqual(sorted.map((item) => item.product.id),
    ['down', 'down-tie', 'stable', 'up', 'none']);
});

test('기본 정렬은 입력 순서를 유지하고 잘못된 모드는 거부한다', () => {
  const items = [row('a', null), row('b', trend(110, 100, 110, 4))];
  const sorted = Decision.sortRows(items, 'default');
  assert.deepEqual(sorted, items);
  assert.notEqual(sorted, items);
  assert.throws(() => Decision.sortRows(items, 'invalid'), /지원하지/);
});

test('실제 게임의 관측 결과를 정렬해도 시장 가격·난수 상태와 저장을 변경하지 않는다', () => {
  const session = new Realtime.RealtimeSession({
    GameClass: Game, seed: 'decision-sort-real', startedAtMs: 100000, msPerDay: 1000
  });
  session.advanceTo(104000);
  const gameBefore = session.game.exportCheckpoint();
  const saveBefore = session.toSave();
  const rows = Game.PRODUCTS.map((product) => ({
    product, trend: session.localMarketTrend(product.id)
  }));
  for (const mode of Decision.MODES) {
    const output = Decision.sortRows(rows, mode);
    assert.equal(output.length, rows.length);
    for (const item of output) Decision.signal(item.trend);
  }
  assert.deepEqual(session.game.exportCheckpoint(), gameBefore);
  assert.deepEqual(session.toSave(), saveBefore);
});

console.log('\nAll Merchant Globe market decision UX tests passed.');
