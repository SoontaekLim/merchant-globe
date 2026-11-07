(function (global) {
  'use strict';

  // Read-only analysis. Replaying successful actions preserves the 0.4 save format.
  const REPORT_VERSION = 1;

  function pairKey(from, to) {
    return [from, to].sort().join('<->');
  }

  function addCount(target, key, count) {
    target[key] = (target[key] || 0) + (count == null ? 1 : count);
  }

  function highest(items, value) {
    return items.slice().sort((a, b) => value(b) - value(a))[0] || null;
  }

  function dailySamples(samples) {
    const lastByDay = new Map();
    samples.forEach((sample) => lastByDay.set(sample.day, sample));
    return [...lastByDay.values()].sort((a, b) => a.day - b.day);
  }

  function buildReport(options, GameClass, SaveSystem) {
    const opts = options || {};
    if (!GameClass || !SaveSystem || typeof SaveSystem.applyAction !== 'function') {
      throw new Error('게임 기록 분석에 필요한 모듈이 없습니다.');
    }
    if (!Array.isArray(opts.actions)) throw new Error('행동 기록이 올바르지 않습니다.');
    if (typeof opts.seed !== 'number' && typeof opts.seed !== 'string') {
      throw new Error('게임 시드가 올바르지 않습니다.');
    }

    const game = new GameClass({ seed: opts.seed, maxDay: opts.maxDay || 30 });
    const startingAssets = game.totalAssets();
    const startingCash = game.cash;
    const timeline = [];
    const snapshots = [];
    const productTotals = {};
    const routeCounts = {};
    const routePairCounts = {};
    const cityVisits = { [game.cityId]: 1 };
    const visibleEvents = [];
    const seenEventIds = new Set();
    let firstCityId = game.cityId;

    function sample(actionIndex) {
      snapshots.push({
        day: game.day,
        actionIndex,
        cityId: game.cityId,
        cash: game.cash,
        assets: game.totalAssets()
      });
    }

    function captureVisibleEvents(actionIndex) {
      const events = [...game.marketRumors(), ...game.routeNotices()];
      events.forEach((event) => {
        if (seenEventIds.has(event.id)) return;
        seenEventIds.add(event.id);
        const entry = {
          type: 'event',
          day: game.day,
          actionIndex,
          eventId: event.id,
          category: event.type === 'route' ? 'route' : 'market',
          kind: event.kind,
          cityId: event.cityId || null,
          routeKey: event.routeKey || null,
          productId: event.productId || null,
          precision: event.precision || 'public',
          title: event.title,
          description: event.description
        };
        visibleEvents.push(entry);
        timeline.push(entry);
      });
    }

    sample(0);
    captureVisibleEvents(0);

    opts.actions.forEach((action, index) => {
      const actionIndex = index + 1;
      const beforeDay = game.day;
      const beforeCityId = game.cityId;
      const result = SaveSystem.applyAction(game, action);
      const entry = {
        type: action.type,
        actionIndex,
        day: game.day,
        startedDay: beforeDay,
        cityId: beforeCityId,
        cashAfter: game.cash,
        assetsAfter: game.totalAssets()
      };

      if (action.type === 'buy' || action.type === 'sell') {
        entry.productId = result.productId;
        entry.quantity = result.qty;
        entry.unitPrice = result.unitPrice;

        if (!productTotals[result.productId]) {
          productTotals[result.productId] = { bought: 0, spent: 0, sold: 0, revenue: 0, realizedProfit: 0 };
        }
        const product = productTotals[result.productId];
        if (action.type === 'buy') {
          entry.total = result.total;
          product.bought += result.qty;
          product.spent += result.total;
        } else {
          entry.revenue = result.revenue;
          entry.profit = result.profit;
          product.sold += result.qty;
          product.revenue += result.revenue;
          product.realizedProfit += result.profit;
        }
      } else if (action.type === 'travel') {
        entry.from = result.from;
        entry.to = result.to;
        entry.days = result.days;
        entry.cost = result.cost;
        entry.cargoUnits = Object.values(game.inventory).reduce((sum, item) => sum + item.qty, 0);
        addCount(routeCounts, result.from + '->' + result.to);
        addCount(routePairCounts, pairKey(result.from, result.to));
        addCount(cityVisits, result.to);
      } else if (action.type === 'upgradeCargo' || action.type === 'upgradeIntel') {
        entry.cost = result.cost;
        entry.level = action.type === 'upgradeCargo' ? game.cargoUpgradeLevel : game.intelLevel;
      }

      timeline.push(entry);
      captureVisibleEvents(actionIndex);
      sample(actionIndex);
    });

    const sales = timeline.filter((entry) => entry.type === 'sell');
    const bestSale = highest(sales, (sale) => sale.profit);
    const worstSale = sales.slice().sort((a, b) => a.profit - b.profit)[0] || null;
    const leadingProduct = highest(
      Object.entries(productTotals).map(([productId, totals]) => ({ productId, ...totals })),
      (product) => product.realizedProfit
    );
    const busiestRoute = highest(
      Object.entries(routePairCounts).map(([route, count]) => ({ route, count })),
      (row) => row.count
    );
    const allSnapshots = dailySamples(snapshots);
    const finalAssets = game.totalAssets();

    return {
      schemaVersion: REPORT_VERSION,
      gameVersion: SaveSystem.GAME_VERSION || null,
      seed: opts.seed,
      firstCityId,
      maxDay: game.maxDay,
      currentDay: game.day,
      completed: game.gameOver,
      currentCityId: game.cityId,
      startingCash,
      startingAssets,
      finalCash: game.cash,
      finalAssets,
      netAssetsChange: finalAssets - startingAssets,
      stats: { ...game.stats },
      upgrades: { cargo: game.cargoUpgradeLevel, intel: game.intelLevel },
      productTotals,
      routeCounts,
      routePairCounts,
      cityVisits,
      bestSale,
      worstSale,
      leadingProduct,
      busiestRoute,
      dailyAssets: allSnapshots,
      visibleEvents,
      timeline
    };
  }

  const api = { REPORT_VERSION, pairKey, dailySamples, buildReport };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.MerchantGlobeReport = api;
})(typeof window !== 'undefined' ? window : globalThis);
