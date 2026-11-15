'use strict';

const assert = require('node:assert/strict');
const { Game } = require('../game-core.js');
const RT = require('../realtime-core.js');

function test(name, fn) {
  try { fn(); console.log('✓ ' + name); }
  catch (error) { console.error('✗ ' + name); throw error; }
}

function session(seed = 'first-hand-observation') {
  return new RT.RealtimeSession({
    GameClass: Game, seed, startedAtMs: 100000, msPerDay: 1000
  });
}

test('현재 도시에서 직접 본 Day1/Day2 가격만 기록하고 전일 변동률을 계산한다', () => {
  const s = session('day-to-day-observations');
  const day1 = s.localMarketTrend('tea');
  assert.equal(day1.day, 1);
  assert.equal(day1.observedDays, 1);
  assert.equal(day1.previousDayPrice, null);
  assert.equal(day1.currentPrice, s.game.marketInfo('seoul', 'tea').price);

  s.advanceTo(101000);
  const day2 = s.localMarketTrend('tea');
  assert.equal(day2.day, 2);
  assert.equal(day2.observedDays, 2);
  assert.equal(day2.previousDayPrice, day1.currentPrice);
  assert.equal(day2.currentPrice, s.game.marketInfo('seoul', 'tea').price);
  assert.equal(day2.previousDayPercent, (day2.currentPrice / day1.currentPrice - 1) * 100);
  assert.equal(day2.minPrice, Math.min(day1.currentPrice, day2.currentPrice));
  assert.equal(day2.maxPrice, Math.max(day1.currentPrice, day2.currentPrice));
});

test('같은 날짜의 매입·판매는 새 날짜를 만들지 않고 마지막 관측 시세만 갱신한다', () => {
  const s = session('trade-updates-current-observation');
  s.perform('buy', { productId: 'rice', qty: 4 }, 100100);
  s.perform('sell', { productId: 'rice', qty: 2 }, 100200);
  assert.equal(s.game.day, 1);
  assert.equal(s.localMarketDiary.seoul.length, 1);
  assert.equal(s.localMarketDiary.seoul[0].day, 1);
  assert.equal(s.localMarketDiary.seoul[0].prices.rice, s.game.marketInfo('seoul', 'rice').price);
});

test('운송 중에는 출발 도시를 관측하지 않으며 새 도시는 도착 후에만 기록한다', () => {
  const s = session('travel-is-not-a-market-observation');
  const trip = s.perform('startTravel', { destinationId: 'shanghai' }, 100000);
  assert.equal(s.localMarketTrend('tea'), null);
  assert.equal(s.localMarketDiary.seoul.length, 1);
  assert.equal(s.localMarketDiary.shanghai, undefined);
  s.advanceTo(trip.arriveAtMs - 1);
  assert.equal(s.localMarketDiary.seoul.length, 1);
  assert.equal(s.localMarketDiary.shanghai, undefined);
  s.advanceTo(trip.arriveAtMs);
  assert.equal(s.game.cityId, 'shanghai');
  assert.equal(s.localMarketDiary.shanghai.length, 1);
  assert.equal(s.localMarketTrend('tea').observedDays, 1);
  assert.equal(s.localMarketTrend('tea').previousDayPrice, null);
});

test('최근 7게임일 관측만 보여주고 도시별 저장은 8회로 제한한다', () => {
  const s = session('bounded-local-observations');
  s.advanceTo(100000 + 18 * 1000);
  assert.equal(s.game.day, 19);
  const rows = s.localMarketDiary.seoul;
  assert.equal(rows.length, RT.LOCAL_MARKET_DIARY_LIMIT);
  assert.equal(rows[0].day, 12);
  assert.equal(rows[rows.length - 1].day, 19);
  assert.equal(s.localMarketTrend('tea').observedDays, 7);
});

test('관측 기능은 가격·시장 사건·화물 경제 상태 및 미래 난수를 변경하지 않는다', () => {
  const seed = 'diary-does-not-change-economy';
  const bare = new Game({ seed, maxDay: Number.MAX_SAFE_INTEGER });
  bare.advanceEconomy(20);
  const s = session(seed);
  s.advanceTo(100000 + 20 * 1000);
  assert.deepEqual(s.game.exportCheckpoint(), bare.exportCheckpoint());
  bare.advanceEconomy(14);
  s.advanceTo(100000 + 34 * 1000);
  assert.deepEqual(s.game.exportCheckpoint(), bare.exportCheckpoint());
});

test('체크포인트 저장·복원 이후 관측 가격과 미래 경제가 결정적으로 같다', () => {
  const s = session('diary-checkpoint-replay');
  s.advanceTo(105000);
  s.perform('buy', { productId: 'paper', qty: 3 }, 105100);
  s.checkpointNow();
  const save = s.toSave();
  assert.ok(save.checkpoint.localMarketDiary.seoul.length);
  const restored = RT.restoreSave(save, Game, s.nowMs);
  assert.deepEqual(restored.localMarketDiary, s.localMarketDiary);
  assert.deepEqual(restored.localMarketTrend('paper'), s.localMarketTrend('paper'));
  s.advanceTo(115000);
  restored.advanceTo(115000);
  assert.deepEqual(restored.game.exportCheckpoint(), s.game.exportCheckpoint());
  assert.deepEqual(restored.localMarketDiary, s.localMarketDiary);
});

test('이전 0.6.1 체크포인트에는 없는 과거 데이터를 만들어내지 않고 현재부터 관측한다', () => {
  const s = session('legacy-checkpoint-observation');
  s.advanceTo(110000);
  s.checkpointNow();
  const oldSave = s.toSave();
  delete oldSave.checkpoint.localMarketDiary;
  const restored = RT.restoreSave(oldSave, Game, s.nowMs);
  assert.deepEqual(restored.game.exportCheckpoint(), s.game.exportCheckpoint());
  assert.equal(restored.localMarketDiary.seoul.length, 1);
  assert.equal(restored.localMarketDiary.seoul[0].day, 11);
  assert.equal(restored.localMarketTrend('tea').previousDayPrice, null);
  restored.advanceTo(111000);
  assert.equal(restored.localMarketTrend('tea').previousDayPrice, restored.localMarketDiary.seoul[0].prices.tea);
});

test('변조된 현지 관측 시세는 저장 복원에서 거부한다', () => {
  const s = session('invalid-diary');
  s.advanceTo(102000);
  s.checkpointNow();
  const corrupt = s.toSave();
  corrupt.checkpoint.localMarketDiary.seoul[0].prices.tea = -1;
  assert.throws(() => RT.restoreSave(corrupt, Game, s.nowMs), /현지 시장 관측/);
});

console.log('\nAll Merchant Globe local market diary tests passed.');
