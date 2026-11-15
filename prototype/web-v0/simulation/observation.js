'use strict';

const { PRODUCTS, CITIES } = require('../game-core.js');

function buildObservation(game) {
  const localMarket = PRODUCTS.map((product) => {
    const info = game.marketInfo(game.cityId, product.id);
    const item = game.inventory[product.id];
    return {
      productId: product.id,
      productName: product.name,
      trait: product.trait,
      cargoSize: product.cargoSize || 1,
      price: info.price,
      stock: info.stock,
      stockLabel: info.stockLabel,
      demandLabel: info.demandLabel,
      heldQty: item.qty,
      avgCost: item.avgCost,
      freshness: game.freshnessMultiplier(product.id)
    };
  });

  const remoteMarkets = {};
  const routes = {};
  Object.keys(CITIES).forEach((cityId) => {
    if (cityId === game.cityId) return;

    const intel = game.remoteIntel(cityId);
    remoteMarkets[cityId] = {
      cityId,
      cityName: CITIES[cityId].name,
      live: intel.live,
      entries: intel.entries.map((entry) => ({ ...entry }))
    };

    const route = game.routeInfo(game.cityId, cityId);
    routes[cityId] = {
      destinationId: cityId,
      destinationName: CITIES[cityId].name,
      cost: route.cost,
      days: route.days,
      baseCost: route.baseCost,
      baseDays: route.baseDays,
      condition: route.events.length ? route.events[0].kind : 'normal'
    };
  });

  return {
    day: game.day,
    maxDay: game.maxDay,
    gameOver: game.gameOver,
    cityId: game.cityId,
    cityName: CITIES[game.cityId].name,
    cash: game.cash,
    capacity: game.capacity,
    cargoUsed: game.cargoUsed(),
    cargoFree: Math.max(0, game.capacity - game.cargoUsed()),
    cargoUpgradeCost: game.cargoUpgradeCost(),
    intelLevel: game.intelLevel,
    intelUpgradeCost: game.intelUpgradeCost(),
    inventory: PRODUCTS.map((product) => ({
      productId: product.id,
      productName: product.name,
      qty: game.inventory[product.id].qty,
      avgCost: game.inventory[product.id].avgCost,
      freshness: game.freshnessMultiplier(product.id),
      cargoSize: product.cargoSize || 1
    })),
    localMarket,
    remoteMarkets,
    routes,
    publicRouteNotices: game.routeNotices().map((event) => ({ ...event })),
    visibleMarketRumors: game.marketRumors().map((event) => ({ ...event }))
  };
}

module.exports = { buildObservation };
