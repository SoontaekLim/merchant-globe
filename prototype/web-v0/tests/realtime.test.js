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

console.log('\nAll Merchant Globe realtime tests passed.');
