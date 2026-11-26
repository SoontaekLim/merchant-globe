(function (global) {
  'use strict';

  // Read only player-visible intel. Never query a remote market's live state
  // or execution price: doing so would bypass the information network.
  function compare(game, cityIds, productId, quantity, mode, tradeUX) {
    const product = game.getProduct(productId);
    if (!product || !['buy', 'held'].includes(mode)) throw new Error('비교 상품 또는 방식이 올바르지 않습니다.');
    const qty = tradeUX.normalizeQuantity(quantity);
    const item = game.inventory[productId];
    const quote = mode === 'buy' ? tradeUX.quote(game, productId, qty).buy : null;
    const basis = mode === 'buy' ? quote.total : item.qty >= qty ? item.avgCost * qty : null;
    const cashAfter = mode === 'buy' && basis !== null ? game.cash - basis : game.cash;
    const freshness = game.freshnessMultiplier(productId);
    const startQuality = product.trait !== 'perishable' ? 1 :
      mode === 'buy' ? (item.qty * freshness + qty) / (item.qty + qty) : freshness;
    const rows = cityIds.filter(id => id !== game.cityId).map(cityId => {
      const route = game.routeInfo(game.cityId, cityId);
      if (!route) return null;
      const intel = game.remoteIntel(cityId);
      const entry = intel.live ? null : intel.entries.find(row => row.productId === productId);
      const observed = entry && Number.isFinite(entry.price) && entry.price > 0 &&
        Number.isInteger(entry.age) && entry.age >= 0 && Number.isInteger(entry.capturedDay) &&
        entry.capturedDay <= game.day ? entry : null;
      const quality = product.trait === 'perishable'
        ? Math.max(product.freshnessFloor || 0.5, startQuality - (product.spoilageRate || 0) * route.days) : 1;
      const affordable = basis !== null && cashAfter >= route.cost;
      // Approximate only: observed market midpoint, normal sell spread and
      // projected quality. Remote quantity impact and future prices are unknown.
      const unitEstimate = observed ? Math.max(10, Math.round(observed.price * 0.985 * quality / 10) * 10) : null;
      const revenue = unitEstimate === null ? null : unitEstimate * qty;
      const net = affordable && revenue !== null ? revenue - basis - route.cost : null;
      return {
        cityId, cost: route.cost, days: route.days,
        observedPrice: observed ? observed.price : null,
        capturedDay: observed ? observed.capturedDay : null,
        age: observed ? observed.age : null,
        arrivalAge: observed ? observed.age + route.days : null,
        quality, affordable, revenue, net,
        netPerDay: net === null ? null : net / route.days
      };
    }).filter(Boolean);
    return { qty, mode, basis, reason: basis !== null ? null :
      mode === 'buy' ? (quote.reason || '매입 불가') : '보유 수량 부족', rows };
  }

  const api = { compare };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.MerchantGlobeRemoteComparison = api;
})(typeof window !== 'undefined' ? window : globalThis);
