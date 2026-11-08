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

console.log('\nAll Merchant Globe realtime tests passed.');
