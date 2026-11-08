(function (global) {
  'use strict';

  // Read-only trade estimates. Use the same executionPrice() as buy()/sell().
  const MAX_INPUT_QUANTITY = 9999;

  function normalizeQuantity(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 1;
    return Math.max(1, Math.min(MAX_INPUT_QUANTITY, Math.floor(number)));
  }

  function maxBuyWithinBudget(game, productId, availableCash) {
    const product = game.getProduct(productId);
    if (!product) throw new Error('존재하지 않는 상품입니다.');
    if (game.gameOver) return 0;

    const budget = Math.max(0, Number(availableCash) || 0);
    const stock = Math.max(0, Math.floor(game.getMarketState(game.cityId, productId).stock));
    const availableSlots = Math.max(0, game.capacity - game.cargoUsed());
    const maxByCargo = Math.floor(availableSlots / (product.cargoSize || 1));
    let low = 0;
    let high = Math.min(stock, maxByCargo, MAX_INPUT_QUANTITY);

    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      const cost = game.executionPrice(game.cityId, productId, middle, 'buy') * middle;
      if (cost <= budget) low = middle;
      else high = middle - 1;
    }
    return low;
  }

  function tradeBudget(game, productId, quantity, destinationId) {
    const route = game.routeInfo(game.cityId, destinationId);
    if (!route) throw new Error('운송비를 계산할 항로가 없습니다.');
    const estimate = quote(game, productId, quantity);
    const maxWithTransport = maxBuyWithinBudget(game, productId, game.cash - route.cost);
    const maxWithoutTransport = estimate.buy.maxQuantity;
    const buyCashAfter = estimate.buy.allowed ? game.cash - estimate.buy.total : null;
    const sellCashAfter = estimate.sell.allowed ? game.cash + estimate.sell.revenue : null;

    return {
      route: { from: route.from, to: route.to, cost: route.cost, days: route.days },
      cashBefore: game.cash,
      buy: {
        ...estimate.buy,
        cashAfter: buyCashAfter,
        cashAfterTransport: buyCashAfter == null ? null : buyCashAfter - route.cost
      },
      sell: {
        ...estimate.sell,
        cashAfter: sellCashAfter,
        cashAfterTransport: sellCashAfter == null ? null : sellCashAfter - route.cost
      },
      maxWithoutTransport,
      maxWithTransport
    };
  }

  function quote(game, productId, requestedQuantity) {
    const product = game.getProduct(productId);
    if (!product) throw new Error('존재하지 않는 상품입니다.');

    const qty = normalizeQuantity(requestedQuantity);
    const availableStock = Math.max(0, Math.floor(game.getMarketState(game.cityId, productId).stock));
    const freeSlots = Math.max(0, game.capacity - game.cargoUsed());
    const cargoSize = product.cargoSize || 1;
    const maxByCargo = Math.floor(freeSlots / cargoSize);
    const maxBuy = maxBuyWithinBudget(game, productId, game.cash);
    const maxSell = game.gameOver ? 0 : Math.max(0, Math.floor(game.inventory[productId].qty));

    const buyAllowed = qty <= maxBuy;
    const sellAllowed = qty <= maxSell;
    const buyUnitPrice = buyAllowed ? game.executionPrice(game.cityId, productId, qty, 'buy') : null;
    const sellUnitPrice = sellAllowed ? game.executionPrice(game.cityId, productId, qty, 'sell') : null;

    let buyLimitReason = null;
    if (maxBuy === 0) {
      if (game.gameOver) buyLimitReason = '거래 기간 종료';
      else if (availableStock === 0) buyLimitReason = '시장 재고 없음';
      else if (maxByCargo === 0) buyLimitReason = '화물칸 부족';
      else buyLimitReason = '현금 부족';
    } else if (!buyAllowed) {
      buyLimitReason = '최대 ' + maxBuy + '개 매입 가능';
    }

    return {
      quantity: qty,
      buy: {
        allowed: buyAllowed,
        maxQuantity: maxBuy,
        unitPrice: buyUnitPrice,
        total: buyUnitPrice == null ? null : buyUnitPrice * qty,
        reason: buyLimitReason
      },
      sell: {
        allowed: sellAllowed,
        maxQuantity: maxSell,
        unitPrice: sellUnitPrice,
        revenue: sellUnitPrice == null ? null : sellUnitPrice * qty,
        profit: sellUnitPrice == null ? null : (sellUnitPrice - game.inventory[productId].avgCost) * qty,
        reason: sellAllowed ? null : maxSell ? '보유 ' + maxSell + '개' : '보유 상품 없음'
      }
    };
  }

  const CONTROL_MODES = Object.freeze([
    'preset_1', 'preset_5', 'preset_10', 'custom', 'max_buy', 'reserve_max_buy', 'sell_all'
  ]);

  function createControlEntry(options) {
    const opts = options || {};
    if (!CONTROL_MODES.includes(opts.control)) throw new Error('알 수 없는 거래 입력 방식입니다.');
    if (!['buy', 'sell'].includes(opts.side)) throw new Error('알 수 없는 거래 유형입니다.');
    if (!Number.isInteger(opts.actionIndex) || opts.actionIndex < 1) throw new Error('거래 행동 위치가 올바르지 않습니다.');
    if (!Number.isInteger(opts.quantity) || opts.quantity < 1) throw new Error('거래 수량이 올바르지 않습니다.');
    if (typeof opts.productId !== 'string' || !opts.productId) throw new Error('상품 ID가 올바르지 않습니다.');
    if ((['max_buy', 'reserve_max_buy'].includes(opts.control) && opts.side !== 'buy') || (opts.control === 'sell_all' && opts.side !== 'sell')) {
      throw new Error('거래 입력 방식과 거래 유형이 일치하지 않습니다.');
    }

    return {
      type: 'trade_control',
      actionIndex: opts.actionIndex,
      day: opts.day,
      cityId: opts.cityId,
      side: opts.side,
      productId: opts.productId,
      quantity: opts.quantity,
      control: opts.control
    };
  }

  function summarizeControls(actions, entries) {
    const counts = Object.fromEntries(CONTROL_MODES.map((mode) => [mode, 0]));
    const validEntries = [];
    const seen = new Set();
    for (const entry of entries || []) {
      if (!entry || !CONTROL_MODES.includes(entry.control) || !Number.isInteger(entry.actionIndex) || seen.has(entry.actionIndex)) continue;
      const action = (actions || [])[entry.actionIndex - 1];
      if (!action || !['buy', 'sell'].includes(action.type)) continue;
      if (action.type !== entry.side || action.productId !== entry.productId || action.qty !== entry.quantity) continue;
      if ((['max_buy', 'reserve_max_buy'].includes(entry.control) && entry.side !== 'buy') || (entry.control === 'sell_all' && entry.side !== 'sell')) continue;
      counts[entry.control]++;
      validEntries.push(entry);
      seen.add(entry.actionIndex);
    }
    const totalTrades = (actions || []).filter((action) => action.type === 'buy' || action.type === 'sell').length;
    return {
      totalTrades,
      trackedTrades: validEntries.length,
      untrackedTrades: totalTrades - validEntries.length,
      counts,
      entries: validEntries
    };
  }

  const api = { MAX_INPUT_QUANTITY, normalizeQuantity, quote, maxBuyWithinBudget, tradeBudget, CONTROL_MODES, createControlEntry, summarizeControls };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.MerchantGlobeTradeUX = api;
})(typeof window !== 'undefined' ? window : globalThis);
