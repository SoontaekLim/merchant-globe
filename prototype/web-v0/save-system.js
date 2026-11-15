(function (global) {
  'use strict';

  const SAVE_SCHEMA_VERSION = 1;
  const GAME_VERSION = '0.4.0';

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function validateAction(action) {
    if (!action || typeof action !== 'object' || typeof action.type !== 'string') {
      throw new Error('저장 데이터의 행동 기록이 올바르지 않습니다.');
    }

    if (action.type === 'buy' || action.type === 'sell') {
      if (typeof action.productId !== 'string' || !Number.isInteger(action.qty) || action.qty < 1) {
        throw new Error('저장 데이터의 거래 기록이 올바르지 않습니다.');
      }
      return;
    }

    if (action.type === 'travel') {
      if (typeof action.destinationId !== 'string') throw new Error('저장 데이터의 이동 기록이 올바르지 않습니다.');
      return;
    }

    if (action.type === 'upgradeCargo' || action.type === 'upgradeIntel') return;
    throw new Error(`지원하지 않는 저장 행동입니다: ${action.type}`);
  }

  function validateSave(payload) {
    if (!payload || typeof payload !== 'object') throw new Error('저장 데이터가 없습니다.');
    if (payload.schemaVersion !== SAVE_SCHEMA_VERSION) throw new Error('지원하지 않는 저장 형식입니다.');
    if (payload.gameVersion !== GAME_VERSION) throw new Error('현재 버전과 호환되지 않는 저장 데이터입니다.');
    if (typeof payload.seed !== 'string' && typeof payload.seed !== 'number') throw new Error('저장 시드가 올바르지 않습니다.');
    if (!Number.isInteger(payload.maxDay) || payload.maxDay < 1) throw new Error('저장된 거래 기간이 올바르지 않습니다.');
    if (!Array.isArray(payload.actions)) throw new Error('저장된 행동 기록이 올바르지 않습니다.');
    payload.actions.forEach(validateAction);
    return true;
  }

  function applyAction(game, action) {
    validateAction(action);
    switch (action.type) {
      case 'buy': return game.buy(action.productId, action.qty);
      case 'sell': return game.sell(action.productId, action.qty);
      case 'travel': return game.travel(action.destinationId);
      case 'upgradeCargo': return game.upgradeCargo();
      case 'upgradeIntel': return game.upgradeIntel();
      default: throw new Error(`지원하지 않는 저장 행동입니다: ${action.type}`);
    }
  }

  function createSavePayload(options) {
    const opts = options || {};
    const payload = {
      schemaVersion: SAVE_SCHEMA_VERSION,
      gameVersion: GAME_VERSION,
      savedAt: new Date().toISOString(),
      seed: opts.seed,
      maxDay: opts.maxDay || 30,
      selectedIntelCity: opts.selectedIntelCity || 'busan',
      actions: clone(opts.actions || [])
    };
    validateSave(payload);
    return payload;
  }

  function restoreGame(payload, GameClass) {
    validateSave(payload);
    if (typeof GameClass !== 'function') throw new Error('게임 엔진을 불러올 수 없습니다.');

    const game = new GameClass({ seed: payload.seed, maxDay: payload.maxDay });
    payload.actions.forEach((action) => applyAction(game, action));

    return {
      game,
      seed: payload.seed,
      maxDay: payload.maxDay,
      selectedIntelCity: payload.selectedIntelCity || 'busan',
      actions: clone(payload.actions),
      savedAt: payload.savedAt || null
    };
  }

  const api = {
    SAVE_SCHEMA_VERSION,
    GAME_VERSION,
    validateSave,
    applyAction,
    createSavePayload,
    restoreGame
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.MerchantGlobeSave = api;
})(typeof window !== 'undefined' ? window : globalThis);
