const assert = require('node:assert/strict');
const { Game } = require('../game-core.js');
const SaveSystem = require('../save-system.js');

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
}

function play(game, actions) {
  actions.forEach((action) => SaveSystem.applyAction(game, action));
}

test('저장 행동 기록을 재생하면 동일한 게임 상태가 복원된다', () => {
  const seed = 'save-replay-state';
  const actions = [
    { type: 'buy', productId: 'rice', qty: 2 },
    { type: 'travel', destinationId: 'busan' },
    { type: 'sell', productId: 'rice', qty: 1 },
    { type: 'travel', destinationId: 'fukuoka' }
  ];

  const original = new Game({ seed, maxDay: 30 });
  play(original, actions);

  const payload = SaveSystem.createSavePayload({
    seed,
    maxDay: 30,
    selectedIntelCity: 'busan',
    actions
  });
  const restored = SaveSystem.restoreGame(payload, Game);

  assert.deepEqual(restored.game.snapshot(), original.snapshot());
  assert.deepEqual(restored.game.market, original.market);
  assert.equal(restored.selectedIntelCity, 'busan');
});

test('복원 후 미래 경제와 이벤트도 원래 플레이와 동일하게 이어진다', () => {
  const seed = 'save-replay-rng';
  const actions = [
    { type: 'buy', productId: 'tea', qty: 2 },
    { type: 'travel', destinationId: 'busan' },
    { type: 'travel', destinationId: 'osaka' }
  ];

  const original = new Game({ seed, maxDay: 30 });
  play(original, actions);
  const payload = SaveSystem.createSavePayload({ seed, maxDay: 30, actions });
  const restored = SaveSystem.restoreGame(payload, Game).game;

  const originalEvents = original.advanceEconomy(4);
  const restoredEvents = restored.advanceEconomy(4);

  assert.deepEqual(restoredEvents, originalEvents);
  assert.deepEqual(restored.market, original.market);
  assert.deepEqual(restored.marketDynamics, original.marketDynamics);
  assert.deepEqual(restored.events, original.events);
  assert.deepEqual(restored.routeEvents, original.routeEvents);
});

test('업그레이드 행동도 저장 기록으로 복원된다', () => {
  const cargoPayload = SaveSystem.createSavePayload({
    seed: 'save-upgrade-cargo',
    maxDay: 30,
    actions: [{ type: 'upgradeCargo' }]
  });
  assert.equal(SaveSystem.restoreGame(cargoPayload, Game).game.capacity, 25);

  const intelPayload = SaveSystem.createSavePayload({
    seed: 'save-upgrade-intel',
    maxDay: 30,
    actions: [{ type: 'upgradeIntel' }]
  });
  assert.equal(SaveSystem.restoreGame(intelPayload, Game).game.intelLevel, 1);
});

test('다른 게임 버전의 저장 데이터는 불러오지 않는다', () => {
  const payload = SaveSystem.createSavePayload({ seed: 'save-version', maxDay: 30, actions: [] });
  payload.gameVersion = '0.3.0';
  assert.throws(() => SaveSystem.restoreGame(payload, Game), /호환되지 않는/);
});

console.log('\nAll Merchant Globe save tests passed.');
