'use strict';

function hashSeed(value) {
  let h = 2166136261 >>> 0;
  for (const ch of String(value)) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0 || 1;
}

function createRng(seed) {
  let state = hashSeed(seed);
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
}

class RandomBot {
  constructor(options = {}) {
    this.name = 'random';
    this.rng = createRng(options.seed || 'random-bot');
    this.actionsSinceTravel = 0;
  }

  pick(list) {
    return list[Math.floor(this.rng() * list.length)];
  }

  decide(observation) {
    if (observation.gameOver) return { type: 'stop' };

    const held = observation.inventory.filter((item) => item.qty > 0);
    const destinations = Object.values(observation.routes)
      .filter((route) => observation.cash >= route.cost);

    if (this.actionsSinceTravel >= 3 && destinations.length) {
      this.actionsSinceTravel = 0;
      return { type: 'travel', destinationId: this.pick(destinations).destinationId };
    }

    const roll = this.rng();

    if (held.length && roll < 0.30) {
      this.actionsSinceTravel += 1;
      const item = this.pick(held);
      const qty = 1 + Math.floor(this.rng() * item.qty);
      return { type: 'sell', productId: item.productId, quantity: qty };
    }

    if (roll < 0.62) {
      const candidates = observation.localMarket.filter((row) => {
        const slots = Math.max(1, row.cargoSize);
        const affordable = Math.floor(observation.cash / Math.max(1, row.price * 1.05));
        const fit = Math.floor(observation.cargoFree / slots);
        return row.stock > 0 && affordable > 0 && fit > 0;
      });
      if (candidates.length) {
        this.actionsSinceTravel += 1;
        const row = this.pick(candidates);
        const maxQty = Math.min(
          4,
          row.stock,
          Math.floor(observation.cash / Math.max(1, row.price * 1.05)),
          Math.floor(observation.cargoFree / Math.max(1, row.cargoSize))
        );
        if (maxQty > 0) {
          return {
            type: 'buy',
            productId: row.productId,
            quantity: 1 + Math.floor(this.rng() * maxQty)
          };
        }
      }
    }

    if (destinations.length) {
      this.actionsSinceTravel = 0;
      return { type: 'travel', destinationId: this.pick(destinations).destinationId };
    }

    if (held.length) {
      const item = this.pick(held);
      return { type: 'sell', productId: item.productId, quantity: item.qty };
    }

    return { type: 'stop', reason: 'no-affordable-action' };
  }
}

module.exports = { RandomBot, createRng };
