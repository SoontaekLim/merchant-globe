(function (global) {
  'use strict';

  // Prototype clock ratio only: one economic day per real minute. This is
  // configurable at session creation for accelerated, deterministic tests.
  const SAVE_SCHEMA_VERSION = 1;
  const DEFAULT_MS_PER_DAY = 60000;
  const MAX_ADVANCE_TICKS = 100000;
  const MAX_ACTIONS = 100000;
  const UNLIMITED_DAY = Number.MAX_SAFE_INTEGER;
  const TYPES = Object.freeze(['buy', 'sell', 'upgradeCargo', 'upgradeIntel', 'startTravel']);

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function integer(value, label, min, max) {
    if (!Number.isSafeInteger(value) || value < min || (max != null && value > max)) {
      throw new Error(label + ' 값이 올바르지 않습니다.');
    }
    return value;
  }

  class RealtimeSession {
    constructor(options) {
      const opts = options || {};
      if (typeof opts.GameClass !== 'function') throw new Error('경제 엔진이 필요합니다.');
      this.seed = opts.seed;
      if (typeof this.seed !== 'string' && typeof this.seed !== 'number') {
        throw new Error('게임 시드가 필요합니다.');
      }
      this.startedAtMs = integer(opts.startedAtMs, '시작 시각', 0);
      this.msPerDay = integer(opts.msPerDay == null ? DEFAULT_MS_PER_DAY : opts.msPerDay, '경제 갱신 간격', 1, 86400000);
      this.nowMs = this.startedAtMs;
      this.game = new opts.GameClass({ seed: this.seed, maxDay: UNLIMITED_DAY });
      this.transit = null;
      this.actions = [];
    }

    nextTickAtMs() {
      return this.startedAtMs + this.game.day * this.msPerDay;
    }

    remainingMs() {
      return this.transit ? Math.max(0, this.transit.arriveAtMs - this.nowMs) : 0;
    }

    advanceTo(targetMs) {
      integer(targetMs, '현재 시각', 0);
      if (targetMs <= this.nowMs) return { ticks: 0, arrived: false, nowMs: this.nowMs };
      const totalTick = Math.floor((targetMs - this.startedAtMs) / this.msPerDay);
      const due = totalTick - (this.game.day - 1);
      if (due > MAX_ADVANCE_TICKS) {
        throw new Error('오프라인 경과 시간이 너무 깁니다. 복구를 위해 진행 기록을 분할해야 합니다.');
      }

      let ticks = 0;
      let arrived = false;
      if (this.transit && this.transit.arriveAtMs <= targetMs) {
        const arrivalTicks = Math.floor((this.transit.arriveAtMs - this.startedAtMs) / this.msPerDay);
        const beforeArrival = Math.max(0, arrivalTicks - (this.game.day - 1));
        if (beforeArrival) {
          this.game.advanceEconomy(beforeArrival);
          ticks += beforeArrival;
        }
        const trip = this.transit;
        this.game.cityId = trip.to;
        this.game.captureIntel(trip.to, this.game.constructor.PRODUCTS
          ? this.game.constructor.PRODUCTS.map((p) => p.id)
          : Object.keys(this.game.inventory));
        this.game.addLog(trip.toName + ' 도착 · ' + trip.days + '일 운송 완료');
        this.transit = null;
        arrived = true;
      }

      const afterArrival = Math.max(0, totalTick - (this.game.day - 1));
      if (afterArrival) {
        this.game.advanceEconomy(afterArrival);
        ticks += afterArrival;
      }
      this.nowMs = targetMs;
      return { ticks, arrived, nowMs: this.nowMs };
    }

    tradeQuote(productId, quantity) {
      return {
        buy: this.game.executionPrice(this.game.cityId, productId, quantity, 'buy') * quantity,
        sell: this.game.executionPrice(this.game.cityId, productId, quantity, 'sell') * quantity
      };
    }

    perform(type, data, atMs) {
      if (!TYPES.includes(type)) throw new Error('지원하지 않는 실시간 행동입니다.');
      const when = integer(atMs, '행동 시각', this.startedAtMs);
      this.advanceTo(when);
      if (this.transit) throw new Error('운송 중에는 거래와 추가 이동을 할 수 없습니다.');
      if (this.actions.length >= MAX_ACTIONS) throw new Error('저장 가능한 행동 수를 초과했습니다.');
      const payload = data || {};
      let result;
      let action;

      if (type === 'buy' || type === 'sell') {
        if (typeof payload.productId !== 'string' || !payload.productId) throw new Error('상품 ID가 올바르지 않습니다.');
        const qty = integer(payload.qty, '거래 수량', 1, 9999);
        result = this.game[type](payload.productId, qty);
        action = { type, atMs: this.nowMs, productId: payload.productId, qty };
        if (payload.surface === 'market' || payload.surface === 'cargo') action.surface = payload.surface;
        if (typeof payload.control === 'string') action.control = payload.control.slice(0, 32);
      } else if (type === 'startTravel') {
        if (typeof payload.destinationId !== 'string' || !payload.destinationId) {
          throw new Error('도착 도시를 선택해야 합니다.');
        }
        const destinationId = payload.destinationId;
        const destination = this.game.getCity(destinationId);
        if (!destination || destinationId === this.game.cityId) throw new Error('이동할 수 없는 도시입니다.');
        const route = this.game.routeInfo(this.game.cityId, destinationId);
        if (!route) throw new Error('이동 가능한 항로가 없습니다.');
        if (this.game.cash < route.cost) throw new Error('운송비가 부족합니다.');

        const from = this.game.cityId;
        this.game.captureIntel(from, Object.keys(this.game.inventory));
        this.game.cash -= route.cost;
        this.game.stats.transportCost += route.cost;
        this.game.stats.trips += 1;
        this.transit = {
          from, to: destinationId, toName: destination.name,
          departedAtMs: this.nowMs,
          arriveAtMs: this.nowMs + route.days * this.msPerDay,
          cost: route.cost, days: route.days
        };
        this.game.addLog(this.game.getCity(from).name + ' → ' + destination.name +
          ' 출발 · ' + route.days + '일 / ' + this.game.money(route.cost));
        result = clone(this.transit);
        action = { type, atMs: this.nowMs, destinationId };
      } else {
        result = type === 'upgradeCargo' ? this.game.upgradeCargo() : this.game.upgradeIntel();
        action = { type, atMs: this.nowMs };
      }

      this.actions.push(action);
      return result;
    }

    toSave() {
      return {
        schemaVersion: SAVE_SCHEMA_VERSION,
        mode: 'realtime',
        seed: this.seed,
        startedAtMs: this.startedAtMs,
        observedAtMs: this.nowMs,
        msPerDay: this.msPerDay,
        actions: clone(this.actions)
      };
    }
  }

  function validateSave(payload) {
    if (!payload || payload.schemaVersion !== SAVE_SCHEMA_VERSION || payload.mode !== 'realtime') {
      throw new Error('지원하지 않는 실시간 저장 형식입니다.');
    }
    if (typeof payload.seed !== 'string' && typeof payload.seed !== 'number') throw new Error('시드가 올바르지 않습니다.');
    integer(payload.startedAtMs, '시작 시각', 0);
    integer(payload.observedAtMs, '저장 시각', payload.startedAtMs);
    integer(payload.msPerDay, '경제 갱신 간격', 1, 86400000);
    if (!Array.isArray(payload.actions) || payload.actions.length > MAX_ACTIONS) throw new Error('행동 기록이 올바르지 않습니다.');
    let lastTime = payload.startedAtMs;
    for (const action of payload.actions) {
      if (!action || !TYPES.includes(action.type)) throw new Error('저장된 행동 유형이 올바르지 않습니다.');
      integer(action.atMs, '행동 시각', lastTime, payload.observedAtMs);
      if (action.type === 'buy' || action.type === 'sell') {
        if (typeof action.productId !== 'string' || !action.productId) throw new Error('저장된 상품 ID가 올바르지 않습니다.');
        integer(action.qty, '저장된 거래 수량', 1, 9999);
      }
      if (action.type === 'startTravel' && (typeof action.destinationId !== 'string' || !action.destinationId)) {
        throw new Error('저장된 이동 목적지가 올바르지 않습니다.');
      }
      lastTime = action.atMs;
    }
    return true;
  }

  function restoreSave(payload, GameClass, nowMs) {
    validateSave(payload);
    const session = new RealtimeSession({
      GameClass, seed: payload.seed,
      startedAtMs: payload.startedAtMs, msPerDay: payload.msPerDay
    });
    payload.actions.forEach((action) => session.perform(action.type, action, action.atMs));
    // A backward system clock must not reverse already-observed economic time.
    session.advanceTo(Math.max(payload.observedAtMs, nowMs == null ? payload.observedAtMs : nowMs));
    return session;
  }

  const api = { RealtimeSession, DEFAULT_MS_PER_DAY, SAVE_SCHEMA_VERSION, validateSave, restoreSave };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.MerchantGlobeRealtime = api;
})(typeof window !== 'undefined' ? window : globalThis);
