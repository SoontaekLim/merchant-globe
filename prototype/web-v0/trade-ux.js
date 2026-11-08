(function (global) {
  'use strict';

  // Read-only trade estimates. Use the same executionPrice() as buy()/sell().
  const MAX_INPUT_QUANTITY = 9999;

  function normalizeQuantity(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 1;
    return Math.max(1, Math.min(MAX_INPUT_QUANTITY, Math.floor(number)));
  }

  function quote(game, productId, requestedQuantity) {
    const product = game.getProduct(productId);
    if (!product) throw new Error('존재하지 않는 상품입니다.');

    const qty = normalizeQuantity(requestedQuantity);
    const availableStock = Math.max(0, Math.floor(game.getMarketState(game.cityId, productId).stock));
    const freeSlots = Math.max(0, game.capacity - game.cargoUsed());
    const cargoSize = product.cargoSize || 1;
    const maxByCargo = Math.floor(freeSlots / cargoSize);
    const maxByStockCargo = Math.min(availableStock, maxByCargo, MAX_INPUT_QUANTITY);

    // The purchase unit price rises with market impact as the lot grows.
    // Binary search, rather than cash / current unit price, finds the actual affordable lot.
    let low = 0;
    let high = maxByStockCargo;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      const cost = game.executionPrice(game.cityId, productId, middle, 'buy') * middle;
      if (cost <= game.cash) low = middle;
      else high = middle - 1;
    }
    const maxBuy = game.gameOver ? 0 : low;
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

  const api = { MAX_INPUT_QUANTITY, normalizeQuantity, quote };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.MerchantGlobeTradeUX = api;
})(typeof window !== 'undefined' ? window : globalThis);
