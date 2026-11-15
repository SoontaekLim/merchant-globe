(function (global) {
  'use strict';

  // Prototype clock ratio defaults to one economic day per real minute.
  // Speed changes preserve the current day's progress and are replayable.
  const SAVE_SCHEMA_VERSION = 1;
  const DEFAULT_MS_PER_DAY = 60000;
  const MAX_ADVANCE_TICKS = 100000;
  const MAX_ACTIONS = 100000;
  const CHECKPOINT_ACTION_INTERVAL = 48;
  const CHECKPOINT_DAY_INTERVAL = 28;
  const DAILY_HISTORY_LIMIT = 180;
  const WEEKLY_HISTORY_LIMIT = 52;
  const UNLIMITED_DAY = Number.MAX_SAFE_INTEGER;
  const TYPES = Object.freeze(['buy', 'sell', 'upgradeCargo', 'upgradeIntel', 'startTravel', 'setSpeed']);
  const COUNTS_AND_COSTS = ['buys', 'sells', 'trips', 'unitsBought', 'unitsSold', 'transportCost', 'investmentCost'];
  const PERFORMANCE_FIELDS = [...COUNTS_AND_COSTS, 'realizedProfit'];

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function integer(value, label, min, max) {
    if (!Number.isSafeInteger(value) || value < min || (max != null && value > max)) {
      throw new Error(label + ' 값이 올바르지 않습니다.');
    }
    return value;
  }

  function emptyPerformance(period, index) {
    const startDay = period === 'week' ? (index - 1) * 7 + 1 : index;
    return {
      period, index, startDay,
      endDay: period === 'week' ? startDay + 6 : index,
      buys: 0, sells: 0, trips: 0,
      unitsBought: 0, unitsSold: 0,
      realizedProfit: 0, transportCost: 0, investmentCost: 0, netProfit: 0
    };
  }

  function netProfit(row) {
    return row.realizedProfit - row.transportCost - row.investmentCost;
  }

  function validateHistory(rows, period, limit, maxIndex) {
    if (!Array.isArray(rows) || rows.length > limit) throw new Error('손익 집계 기록이 올바르지 않습니다.');
    let previousIndex = 0;
    for (const row of rows) {
      if (!row || row.period !== period) throw new Error('손익 집계 단위가 올바르지 않습니다.');
      integer(row.index, '손익 집계 기간', previousIndex + 1, maxIndex);
      const expected = emptyPerformance(period, row.index);
      if (row.startDay !== expected.startDay || row.endDay !== expected.endDay) {
        throw new Error('손익 집계 날짜가 올바르지 않습니다.');
      }
      for (const key of COUNTS_AND_COSTS) integer(row[key], '손익 집계 횟수 또는 비용', 0);
      // Older checkpoints summed net profit separately, so allow rounding error.
      const tolerance = 1e-7 * Math.max(1, Math.abs(row.realizedProfit), row.transportCost, row.investmentCost);
      if (!Number.isFinite(row.realizedProfit) || !Number.isFinite(row.netProfit) ||
          Math.abs(row.netProfit - netProfit(row)) > tolerance) {
        throw new Error('손익 집계 금액이 올바르지 않습니다.');
      }
      previousIndex = row.index;
    }
  }

  function scaleRemaining(remaining, rounding, ratio) {
    const exact = (remaining - rounding) * ratio;
    // Ignore floating-point noise around whole milliseconds.
    const ms = Math.max(1, Math.ceil(exact - 8 * Number.EPSILON * exact));
    return { ms, rounding: Math.max(0, ms - exact) };
  }

  class RealtimeSession {
    constructor(options) {
      const opts = options || {};
      if (typeof opts.GameClass !== 'function') throw new Error('경제 엔진이 필요합니다.');
      this.seed = opts.seed;
      if (typeof this.seed !== 'string' && !Number.isFinite(this.seed)) {
        throw new Error('게임 시드가 필요합니다.');
      }
      this.startedAtMs = integer(opts.startedAtMs, '시작 시각', 0);
      this.msPerDay = integer(opts.msPerDay == null ? DEFAULT_MS_PER_DAY : opts.msPerDay, '경제 갱신 간격', 1, 86400000);
      this.initialMsPerDay = this.msPerDay;
      this.clockEpochMs = this.startedAtMs;
      this.clockEpochDay = 1;
      this.tickRoundingMs = 0;
      this.transitRoundingMs = 0;
      this.nowMs = this.startedAtMs;
      this.game = new opts.GameClass({ seed: this.seed || String(this.startedAtMs), maxDay: UNLIMITED_DAY });
      this.transit = null;
      this.actions = [];
      this.archivedActions = 0;
      this.checkpoint = null;
      this.dailyHistory = [];
      this.weeklyHistory = [];
      this.investmentTotal = 0;
      this.recoveryTargetMs = null;
      this.pendingSave = null;
      this.replayIndex = 0;
    }

    nextTickAtMs() {
      return this.clockEpochMs + (this.game.day - this.clockEpochDay + 1) * this.msPerDay;
    }

    remainingMs() {
      return this.transit ? Math.max(0, this.transit.arriveAtMs - this.nowMs) : 0;
    }

    advanceTo(targetMs) {
      if (this.recoveryTargetMs !== null) throw new Error('오프라인 경제 복구가 진행 중입니다.');
      return this.advanceClockTo(targetMs);
    }

    advanceClockTo(targetMs) {
      integer(targetMs, '현재 시각', 0);
      if (targetMs <= this.nowMs) return { ticks: 0, arrived: false, nowMs: this.nowMs };
      const totalTick = Math.floor((targetMs - this.clockEpochMs) / this.msPerDay);
      const due = totalTick - (this.game.day - this.clockEpochDay);
      if (due > MAX_ADVANCE_TICKS) {
        throw new Error('오프라인 경과 시간이 너무 깁니다. 복구를 위해 진행 기록을 분할해야 합니다.');
      }

      let ticks = 0;
      let arrived = false;
      if (this.transit && this.transit.arriveAtMs <= targetMs) {
        const arrivalTicks = Math.floor((this.transit.arriveAtMs - this.clockEpochMs) / this.msPerDay);
        const beforeArrival = Math.max(0, arrivalTicks - (this.game.day - this.clockEpochDay));
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
        this.transitRoundingMs = 0;
        arrived = true;
      }

      const afterArrival = Math.max(0, totalTick - (this.game.day - this.clockEpochDay));
      if (afterArrival) {
        this.game.advanceEconomy(afterArrival);
        ticks += afterArrival;
      }
      this.nowMs = targetMs;
      return { ticks, arrived, nowMs: this.nowMs };
    }

    // Use bounded batches when catching up a long offline interval.
    // The ordinary advanceTo() API retains its large-call safety guard.
    advanceTowards(targetMs, maxTicks) {
      integer(targetMs, '현재 시각', 0);
      const budget = integer(maxTicks == null ? 250 : maxTicks, '복구 단계 크기', 1, 10000);
      this.recoveryTargetMs = Math.max(targetMs, this.recoveryTargetMs ?? this.nowMs);
      let ticks = 0;
      let arrived = false;
      const advanceBatch = (target) => {
        const nextTickAfterBudget = this.nextTickAtMs() + (budget - ticks) * this.msPerDay;
        const cutoff = target < nextTickAfterBudget ? target : nextTickAfterBudget - this.msPerDay;
        const progress = this.advanceClockTo(Math.max(this.nowMs, cutoff));
        ticks += progress.ticks;
        arrived = arrived || progress.arrived;
      };

      // Replay old action logs with the same budget as offline economy updates.
      const saved = this.pendingSave;
      if (saved) {
        const stopIndex = Math.min(saved.actions.length, this.replayIndex + budget);
        while (this.replayIndex < stopIndex) {
          const action = saved.actions[this.replayIndex];
          advanceBatch(action.atMs);
          if (this.nowMs < action.atMs) break;
          this.applyAction(action.type, action, action.preciseSpeed !== true);
          this.replayIndex++;
        }
        if (this.replayIndex === saved.actions.length) {
          if (saved.activeMsPerDay != null && this.msPerDay !== saved.activeMsPerDay) {
            throw new Error('저장된 경제 속도 변경 기록이 일치하지 않습니다.');
          }
          this.pendingSave = null;
        }
      }
      if (!this.pendingSave) advanceBatch(this.recoveryTargetMs);
      const complete = !this.pendingSave && this.nowMs >= this.recoveryTargetMs;
      if (complete) this.recoveryTargetMs = null;
      return { ticks, arrived, nowMs: this.nowMs, complete };
    }

    // Adjust the active clock without discarding fractional progress through
    // the current economic day. Also rescale an in-flight voyage's remaining
    // time; route costs and the number of remaining game days do not change.
    changeSpeed(nextMsPerDay) {
      return this.perform('setSpeed', { msPerDay: nextMsPerDay }, this.nowMs);
    }

    applySpeed(nextMsPerDay, legacySpeed) {
      const next = integer(nextMsPerDay, '경제 갱신 간격', 1, 86400000);
      const previous = this.msPerDay;
      if (next === previous) return { oldMsPerDay: previous, msPerDay: next };

      const oldRemaining = this.nextTickAtMs() - this.nowMs;
      const ratio = next / previous;
      const scaledTick = legacySpeed
        ? { ms: Math.max(1, Math.ceil(oldRemaining * next / previous)), rounding: 0 }
        : scaleRemaining(oldRemaining, this.tickRoundingMs, ratio);
      this.clockEpochMs = this.nowMs - (next - scaledTick.ms);
      this.clockEpochDay = this.game.day;
      this.tickRoundingMs = scaledTick.rounding;
      this.msPerDay = next;

      if (this.transit) {
        const trip = this.transit;
        const remaining = Math.max(0, trip.arriveAtMs - this.nowMs);
        if (legacySpeed) {
          const elapsed = Math.max(0, this.nowMs - trip.departedAtMs);
          trip.arriveAtMs = this.nowMs + Math.max(1, Math.ceil(remaining * next / previous));
          trip.departedAtMs = this.nowMs - Math.round(elapsed * next / previous);
        } else {
          const scaledTrip = scaleRemaining(remaining, this.transitRoundingMs, ratio);
          trip.arriveAtMs = this.nowMs + scaledTrip.ms;
          trip.departedAtMs = Math.min(this.nowMs, trip.arriveAtMs - trip.days * next);
          this.transitRoundingMs = scaledTrip.rounding;
        }
      }

      return { oldMsPerDay: previous, msPerDay: next };
    }

    recordPerformance(type, result) {
      if (type === 'setSpeed') return;
      const day = this.game.day;
      const week = Math.floor((day - 1) / 7) + 1;
      const delta = emptyPerformance('day', day);
      if (type === 'buy') {
        delta.buys = 1;
        delta.unitsBought = result.qty;
      } else if (type === 'sell') {
        delta.sells = 1;
        delta.unitsSold = result.qty;
        delta.realizedProfit = result.profit;
      } else if (type === 'startTravel') {
        delta.trips = 1;
        delta.transportCost = result.cost;
      } else if (type === 'upgradeCargo' || type === 'upgradeIntel') {
        delta.investmentCost = result.cost;
        this.investmentTotal += result.cost;
      }

      const apply = (rows, period, index, limit) => {
        let row = rows[rows.length - 1];
        if (!row || row.index !== index) {
          row = emptyPerformance(period, index);
          rows.push(row);
          while (rows.length > limit) rows.shift();
        }
        for (const key of PERFORMANCE_FIELDS) row[key] += delta[key];
        row.netProfit = netProfit(row);
      };
      apply(this.dailyHistory, 'day', day, DAILY_HISTORY_LIMIT);
      apply(this.weeklyHistory, 'week', week, WEEKLY_HISTORY_LIMIT);
    }

    recentPerformance(period, limit) {
      if (period !== 'day' && period !== 'week') throw new Error('지원하지 않는 손익 집계 기간입니다.');
      const count = integer(limit == null ? 8 : limit, '조회 기간', 1, 52);
      const nowIndex = period === 'day' ? this.game.day : Math.floor((this.game.day - 1) / 7) + 1;
      const source = period === 'day' ? this.dailyHistory : this.weeklyHistory;
      const byIndex = new Map(source.map((row) => [row.index, row]));
      const result = [];
      for (let index = Math.max(1, nowIndex - count + 1); index <= nowIndex; index++) {
        const row = byIndex.get(index) || emptyPerformance(period, index);
        result.push({ ...row, netProfit: netProfit(row) });
      }
      return result;
    }

    performanceTotals() {
      return {
        realizedProfit: this.game.stats.realizedProfit,
        transportCost: this.game.stats.transportCost,
        investmentCost: this.investmentTotal,
        netProfit: this.game.stats.realizedProfit - this.game.stats.transportCost - this.investmentTotal,
        recordedDays: this.dailyHistory.length,
        recordedWeeks: this.weeklyHistory.length
      };
    }

    // Compact the action tail only after saving the exact economy state and
    // RNG position. Older actions are intentionally summarized, not replayed.
    checkpointNow() {
      if (typeof this.game.exportCheckpoint !== 'function') {
        throw new Error('경제 엔진이 체크포인트 저장을 지원하지 않습니다.');
      }
      if (this.pendingSave) throw new Error('저장 행동 복구가 진행 중입니다.');
      const archivedActions = this.archivedActions + this.actions.length;
      this.checkpoint = {
        atMs: this.nowMs,
        archivedActions,
        msPerDay: this.msPerDay,
        clockEpochMs: this.clockEpochMs,
        clockEpochDay: this.clockEpochDay,
        tickRoundingMs: this.tickRoundingMs,
        transitRoundingMs: this.transitRoundingMs,
        transit: this.transit ? clone(this.transit) : null,
        economy: this.game.exportCheckpoint(),
        dailyHistory: clone(this.dailyHistory),
        weeklyHistory: clone(this.weeklyHistory),
        investmentTotal: this.investmentTotal
      };
      this.archivedActions = archivedActions;
      this.actions = [];
      return this.checkpoint;
    }

    maybeCheckpoint() {
      const checkpointDay = this.checkpoint ? this.checkpoint.economy.day : 1;
      if (this.actions.length >= CHECKPOINT_ACTION_INTERVAL ||
          this.game.day - checkpointDay >= CHECKPOINT_DAY_INTERVAL) this.checkpointNow();
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
      return this.applyAction(type, data || {}, false);
    }

    applyAction(type, payload, legacySpeed) {
      if (this.transit && type !== 'setSpeed') throw new Error('운송 중에는 거래와 추가 이동을 할 수 없습니다.');
      if (this.actions.length >= MAX_ACTIONS) throw new Error('저장 가능한 행동 수를 초과했습니다.');
      let result;
      let action;

      if (type === 'setSpeed') {
        result = this.applySpeed(payload.msPerDay, legacySpeed);
        action = { type, atMs: this.nowMs, msPerDay: this.msPerDay };
        if (!legacySpeed) action.preciseSpeed = true;
      } else if (type === 'buy' || type === 'sell') {
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
      this.recordPerformance(type, result);
      return result;
    }

    toSave() {
      const recovery = this.recoveryTargetMs > this.nowMs ? { recoveryTargetMs: this.recoveryTargetMs } : {};
      if (this.pendingSave) return clone({ ...this.pendingSave, ...recovery });
      if (recovery.recoveryTargetMs && this.checkpoint?.atMs !== this.nowMs) this.checkpointNow();
      else this.maybeCheckpoint();
      return {
        schemaVersion: SAVE_SCHEMA_VERSION,
        mode: 'realtime',
        seed: this.seed,
        startedAtMs: this.startedAtMs,
        observedAtMs: this.nowMs,
        msPerDay: this.initialMsPerDay,
        activeMsPerDay: this.msPerDay,
        archivedActionCount: this.archivedActions,
        checkpoint: this.checkpoint ? clone(this.checkpoint) : null,
        actions: clone(this.actions),
        ...recovery
      };
    }
  }

  function validateSave(payload) {
    if (!payload || payload.schemaVersion !== SAVE_SCHEMA_VERSION || payload.mode !== 'realtime') {
      throw new Error('지원하지 않는 실시간 저장 형식입니다.');
    }
    if (typeof payload.seed !== 'string' && !Number.isFinite(payload.seed)) throw new Error('시드가 올바르지 않습니다.');
    integer(payload.startedAtMs, '시작 시각', 0);
    integer(payload.observedAtMs, '저장 시각', payload.startedAtMs);
    if (payload.recoveryTargetMs != null) integer(payload.recoveryTargetMs, '복구 목표 시각', payload.observedAtMs);
    integer(payload.msPerDay, '경제 갱신 간격', 1, 86400000);
    if (payload.activeMsPerDay != null) integer(payload.activeMsPerDay, '현재 경제 갱신 간격', 1, 86400000);
    if (payload.archivedActionCount != null) integer(payload.archivedActionCount, '압축된 행동 수', 0);
    const cp = payload.checkpoint;
    if (cp != null) {
      if (!cp || typeof cp !== 'object') throw new Error('체크포인트가 올바르지 않습니다.');
      integer(cp.atMs, '체크포인트 시각', payload.startedAtMs, payload.observedAtMs);
      integer(cp.archivedActions, '압축된 행동 수', 0);
      if (payload.archivedActionCount != null && payload.archivedActionCount !== cp.archivedActions) {
        throw new Error('저장된 행동 수와 체크포인트가 일치하지 않습니다.');
      }
      integer(cp.msPerDay, '체크포인트 속도', 1, 86400000);
      integer(cp.clockEpochMs, '체크포인트 시계 기준', payload.startedAtMs - cp.msPerDay + 1, cp.atMs);
      integer(cp.clockEpochDay, '체크포인트 경제 기준', 1);
      if (!cp.economy || !Number.isSafeInteger(cp.economy.day) || cp.economy.day < cp.clockEpochDay ||
          cp.economy.day > Number.MAX_SAFE_INTEGER - 1000) {
        throw new Error('체크포인트 경제 날짜가 올바르지 않습니다.');
      }
      if (Math.floor((cp.atMs - cp.clockEpochMs) / cp.msPerDay) !== cp.economy.day - cp.clockEpochDay) {
        throw new Error('체크포인트 시계와 경제 날짜가 일치하지 않습니다.');
      }
      for (const rounding of [cp.tickRoundingMs ?? 0, cp.transitRoundingMs ?? 0]) {
        if (!Number.isFinite(rounding) || rounding < 0 || rounding >= 1) {
          throw new Error('체크포인트 시계의 밀리초 오차가 올바르지 않습니다.');
        }
      }
      const trip = cp.transit;
      if (trip != null) {
        if (trip.from !== cp.economy.cityId || typeof trip.to !== 'string' ||
            trip.to === trip.from || typeof trip.toName !== 'string') {
          throw new Error('체크포인트 운송 기록이 올바르지 않습니다.');
        }
        integer(trip.departedAtMs, '체크포인트 운송 출발 시각', Number.MIN_SAFE_INTEGER, cp.atMs);
        integer(trip.arriveAtMs, '체크포인트 운송 도착 시각', cp.atMs + 1);
        integer(trip.cost, '체크포인트 운송비', 1);
        integer(trip.days, '체크포인트 운송 기간', 1);
      } else if (cp.transitRoundingMs) {
        throw new Error('체크포인트 운송 기록이 올바르지 않습니다.');
      }
      validateHistory(cp.dailyHistory, 'day', DAILY_HISTORY_LIMIT, cp.economy.day);
      validateHistory(cp.weeklyHistory, 'week', WEEKLY_HISTORY_LIMIT, Math.ceil(cp.economy.day / 7));
      integer(cp.investmentTotal, '체크포인트 성장 투자비', 0);
    } else if (payload.archivedActionCount) {
      throw new Error('압축된 행동의 체크포인트가 없습니다.');
    }
    if (!Array.isArray(payload.actions) || payload.actions.length > MAX_ACTIONS) throw new Error('행동 기록이 올바르지 않습니다.');
    let lastTime = cp ? cp.atMs : payload.startedAtMs;
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
      if (action.type === 'setSpeed') {
        integer(action.msPerDay, '저장된 경제 갱신 간격', 1, 86400000);
        if (action.preciseSpeed != null && typeof action.preciseSpeed !== 'boolean') {
          throw new Error('저장된 경제 속도 변경 기록이 올바르지 않습니다.');
        }
      }
      lastTime = action.atMs;
    }
    return true;
  }

  function restoreSave(payload, GameClass, nowMs, options) {
    validateSave(payload);
    const target = Math.max(payload.observedAtMs, payload.recoveryTargetMs ?? 0,
      integer(nowMs ?? payload.observedAtMs, '현재 시각', 0));
    const session = new RealtimeSession({
      GameClass, seed: payload.seed,
      startedAtMs: payload.startedAtMs, msPerDay: payload.msPerDay
    });
    if (payload.checkpoint) {
      const cp = payload.checkpoint;
      if (typeof session.game.restoreCheckpoint !== 'function') {
        throw new Error('경제 엔진이 체크포인트 복원을 지원하지 않습니다.');
      }
      session.game.restoreCheckpoint(cp.economy);
      if (session.game.maxDay !== UNLIMITED_DAY || session.game.gameOver) {
        throw new Error('체크포인트 실시간 경제 상태가 올바르지 않습니다.');
      }
      if (cp.transit && (!session.game.getRoute(cp.transit.from, cp.transit.to) ||
          session.game.getCity(cp.transit.to)?.name !== cp.transit.toName)) {
        throw new Error('체크포인트 운송 항로가 올바르지 않습니다.');
      }
      session.nowMs = cp.atMs;
      session.msPerDay = cp.msPerDay;
      session.clockEpochMs = cp.clockEpochMs;
      session.clockEpochDay = cp.clockEpochDay;
      session.tickRoundingMs = cp.tickRoundingMs ?? 0;
      session.transitRoundingMs = cp.transitRoundingMs ?? 0;
      session.transit = cp.transit ? clone(cp.transit) : null;
      session.dailyHistory = clone(cp.dailyHistory);
      session.weeklyHistory = clone(cp.weeklyHistory);
      session.investmentTotal = cp.investmentTotal;
      session.archivedActions = cp.archivedActions;
      session.checkpoint = clone(cp);
    }
    session.pendingSave = clone(payload);
    if (options && options.catchUpTicks != null) {
      session.advanceTowards(target, options.catchUpTicks);
    } else {
      while (session.pendingSave || session.nowMs < payload.observedAtMs) {
        session.advanceTowards(payload.observedAtMs, 10000);
      }
      session.advanceTo(target);
    }
    return session;
  }

  const api = { RealtimeSession, DEFAULT_MS_PER_DAY, SAVE_SCHEMA_VERSION,
    CHECKPOINT_ACTION_INTERVAL, CHECKPOINT_DAY_INTERVAL, DAILY_HISTORY_LIMIT, WEEKLY_HISTORY_LIMIT,
    validateSave, restoreSave };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.MerchantGlobeRealtime = api;
})(typeof window !== 'undefined' ? window : globalThis);
