'use strict';

class GreedyBot {
  constructor() {
    this.name = 'greedy';
    this.pendingDestination = null;
    this.pendingTradeKey = null;
    this.visited = new Set();
    this.failedTrades = new Set();
  }

  onActionError(action) {
    if (action && action.type === 'buy' && this.pendingTradeKey) {
      this.failedTrades.add(this.pendingTradeKey);
    }
    this.pendingDestination = null;
    this.pendingTradeKey = null;
  }

  decide(observation) {
    if (observation.gameOver) return { type: 'stop' };
    this.visited.add(observation.cityId);

    const held = observation.inventory.filter((item) => item.qty > 0);

    if (this.pendingDestination) {
      const route = observation.routes[this.pendingDestination];
      if (route && observation.cash >= route.cost) {
        const destinationId = this.pendingDestination;
        this.pendingDestination = null;
        this.pendingTradeKey = null;
        return { type: 'travel', destinationId };
      }
      this.pendingDestination = null;
    }

    if (held.length) {
      const item = held.reduce((best, row) => row.qty > best.qty ? row : best, held[0]);
      return { type: 'sell', productId: item.productId, quantity: item.qty };
    }

    const opportunities = [];
    for (const local of observation.localMarket) {
      const cargoSize = Math.max(1, local.cargoSize);
      const maxByCargo = Math.floor(observation.cargoFree / cargoSize);
      const buyUnitEstimate = local.price * 1.25;
      for (const [destinationId, remote] of Object.entries(observation.remoteMarkets)) {
        const route = observation.routes[destinationId];
        if (!route || observation.cash <= route.cost) continue;
        const entry = remote.entries.find((row) => row.productId === local.productId);
        if (!entry) continue;

        const tradeKey = `${observation.day}:${observation.cityId}:${destinationId}:${local.productId}`;
        if (this.failedTrades.has(tradeKey)) continue;

        const maxByCash = Math.floor((observation.cash - route.cost) / Math.max(1, buyUnitEstimate));
        const maxQty = Math.min(local.stock, maxByCargo, maxByCash);
        if (maxQty <= 0) continue;

        const agePenalty = Math.min(0.18, (entry.age || 0) * 0.025);
        const freshnessAfterTravel = local.trait === 'perishable'
          ? Math.max(0.55, 1 - route.days * 0.07)
          : 1;
        const expectedSell = entry.price * (1 - agePenalty) * 0.985 * freshnessAfterTravel;
        const qty = Math.max(1, Math.min(maxQty, 12));
        const gross = (expectedSell - buyUnitEstimate) * qty;
        const expectedProfit = gross - route.cost;
        const score = expectedProfit / Math.max(1, route.days);

        opportunities.push({
          productId: local.productId,
          destinationId,
          qty,
          expectedProfit,
          score,
          tradeKey
        });
      }
    }

    opportunities.sort((a, b) => b.score - a.score);
    const best = opportunities[0];
    if (best && best.expectedProfit > 0) {
      this.pendingDestination = best.destinationId;
      this.pendingTradeKey = best.tradeKey;
      return { type: 'buy', productId: best.productId, quantity: best.qty };
    }

    const routes = Object.values(observation.routes)
      .filter((route) => observation.cash >= route.cost)
      .sort((a, b) => {
        const aUnknown = this.visited.has(a.destinationId) ? 1 : 0;
        const bUnknown = this.visited.has(b.destinationId) ? 1 : 0;
        if (aUnknown !== bUnknown) return aUnknown - bUnknown;
        const aEfficiency = a.cost + a.days * 180;
        const bEfficiency = b.cost + b.days * 180;
        return aEfficiency - bEfficiency;
      });

    if (routes.length) {
      return { type: 'travel', destinationId: routes[0].destinationId };
    }

    return { type: 'stop', reason: 'no-affordable-route' };
  }
}

module.exports = { GreedyBot };
