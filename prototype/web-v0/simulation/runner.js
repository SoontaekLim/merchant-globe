#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Game, PRODUCTS, CITIES } = require('../game-core.js');
const { buildObservation } = require('./observation.js');
const { RandomBot } = require('./bots/random-bot.js');
const { GreedyBot } = require('./bots/greedy-bot.js');

const STARTING_CASH = 10000;

function parseArgs(argv) {
  const args = { runs: 100, bot: 'all', seed: 'balance', output: null, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--runs') args.runs = Math.max(1, Math.min(100000, Number(argv[++i]) || 100));
    else if (arg === '--bot') args.bot = String(argv[++i] || 'all');
    else if (arg === '--seed') args.seed = String(argv[++i] || 'balance');
    else if (arg === '--output') args.output = String(argv[++i] || '');
    else if (arg === '--quiet') args.quiet = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
  }
  return args;
}

function createBot(name, seed) {
  if (name === 'random') return new RandomBot({ seed });
  if (name === 'greedy') return new GreedyBot();
  throw new Error(`Unknown bot: ${name}`);
}

function executeAction(game, action) {
  if (!action || action.type === 'stop') return { stopped: true };
  if (action.type === 'buy') return game.buy(action.productId, action.quantity);
  if (action.type === 'sell') return game.sell(action.productId, action.quantity);
  if (action.type === 'travel') return game.travel(action.destinationId);
  if (action.type === 'upgradeCargo') return game.upgradeCargo();
  if (action.type === 'upgradeIntel') return game.upgradeIntel();
  throw new Error(`Unknown action type: ${action.type}`);
}

function emptyProductMap() {
  return Object.fromEntries(PRODUCTS.map((product) => [product.id, 0]));
}

function runSimulation(options = {}) {
  const botName = options.bot || 'greedy';
  const seed = options.seed || 'simulation';
  const game = new Game({ seed, maxDay: options.maxDay || 30 });
  const bot = createBot(botName, `${seed}:bot`);
  const productBought = emptyProductMap();
  const productSold = emptyProductMap();
  const productProfit = emptyProductMap();
  const routeCounts = {};
  const cityVisits = Object.fromEntries(Object.keys(CITIES).map((id) => [id, 0]));
  cityVisits[game.cityId] += 1;
  const marketEventIds = new Set();
  const routeEventIds = new Set();
  let actions = 0;
  let actionErrors = 0;
  let stopReason = null;

  const collectEvents = () => {
    game.events.forEach((event) => marketEventIds.add(event.id));
    game.routeEvents.forEach((event) => routeEventIds.add(event.id));
  };

  while (!game.gameOver && actions < (options.maxActions || 500)) {
    const observation = buildObservation(game);
    const action = bot.decide(observation);

    if (!action || action.type === 'stop') {
      stopReason = action && action.reason ? action.reason : 'bot-stop';
      break;
    }

    try {
      const result = executeAction(game, action);
      actions += 1;

      if (action.type === 'buy') {
        productBought[action.productId] += result.qty;
      } else if (action.type === 'sell') {
        productSold[action.productId] += result.qty;
        productProfit[action.productId] += result.profit;
      } else if (action.type === 'travel') {
        const key = `${result.from}->${result.to}`;
        routeCounts[key] = (routeCounts[key] || 0) + 1;
        cityVisits[result.to] = (cityVisits[result.to] || 0) + 1;
      }
      collectEvents();
    } catch (error) {
      actionErrors += 1;
      if (typeof bot.onActionError === 'function') {
        bot.onActionError(action, error, observation);
      } else if (action.type === 'buy' && bot.pendingDestination) {
        bot.pendingDestination = null;
      }
      if (actionErrors >= 20) {
        stopReason = `too-many-action-errors: ${error.message}`;
        break;
      }
    }
  }

  return {
    bot: botName,
    seed,
    completed: game.gameOver,
    stopReason,
    day: game.day,
    actions,
    actionErrors,
    finalAssets: game.totalAssets(),
    finalCash: game.cash,
    netWorthChange: game.totalAssets() - STARTING_CASH,
    stats: { ...game.stats },
    productBought,
    productSold,
    productProfit,
    routeCounts,
    cityVisits,
    marketEventsSeen: marketEventIds.size,
    routeEventsSeen: routeEventIds.size
  };
}

function median(values) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return sorted[index];
}

function mergeNumericMaps(results, field) {
  const merged = {};
  for (const result of results) {
    for (const [key, value] of Object.entries(result[field])) {
      merged[key] = (merged[key] || 0) + value;
    }
  }
  return merged;
}

function routePairKey(route) {
  const [from, to] = String(route).split('->');
  if (!from || !to) return String(route);
  return [from, to].sort().join('<->');
}

function aggregateRoutePairs(routeCounts) {
  const pairs = {};
  for (const [route, count] of Object.entries(routeCounts)) {
    const key = routePairKey(route);
    pairs[key] = (pairs[key] || 0) + count;
  }
  return pairs;
}

function productWinCounts(results) {
  const counts = {};
  for (const result of results) {
    const winner = Object.entries(result.productProfit || {})
      .filter(([, profit]) => profit > 0)
      .sort((a, b) => b[1] - a[1])[0];
    if (!winner) continue;
    counts[winner[0]] = (counts[winner[0]] || 0) + 1;
  }
  return counts;
}

function summarize(botName, results) {
  const assets = results.map((row) => row.finalAssets);
  const completed = results.filter((row) => row.completed).length;
  const productProfit = mergeNumericMaps(results, 'productProfit');
  const productSold = mergeNumericMaps(results, 'productSold');
  const routeCounts = mergeNumericMaps(results, 'routeCounts');
  const routePairCounts = aggregateRoutePairs(routeCounts);
  const cityVisits = mergeNumericMaps(results, 'cityVisits');
  const productWins = productWinCounts(results);
  const stopReasons = {};
  results.forEach((row) => {
    if (!row.completed) {
      const reason = row.stopReason || 'unknown';
      stopReasons[reason] = (stopReasons[reason] || 0) + 1;
    }
  });

  const positiveProductProfit = Object.fromEntries(
    Object.entries(productProfit).map(([key, value]) => [key, Math.max(0, value)])
  );
  const positiveProfitTotal = Object.values(positiveProductProfit).reduce((sum, value) => sum + value, 0);
  const routeTotal = Object.values(routeCounts).reduce((sum, value) => sum + value, 0);

  const topProduct = Object.entries(positiveProductProfit).sort((a, b) => b[1] - a[1])[0] || [null, 0];
  const topRoute = Object.entries(routeCounts).sort((a, b) => b[1] - a[1])[0] || [null, 0];
  const topRoutePair = Object.entries(routePairCounts).sort((a, b) => b[1] - a[1])[0] || [null, 0];
  const topWinningProduct = Object.entries(productWins).sort((a, b) => b[1] - a[1])[0] || [null, 0];

  const warnings = [];
  const topProductShare = positiveProfitTotal > 0 ? topProduct[1] / positiveProfitTotal : 0;
  const topRouteShare = routeTotal > 0 ? topRoute[1] / routeTotal : 0;
  const topRoutePairShare = routeTotal > 0 ? topRoutePair[1] / routeTotal : 0;
  const topWinningProductShare = results.length > 0 ? topWinningProduct[1] / results.length : 0;
  const completionRate = results.length ? completed / results.length : 0;

  if (topProductShare >= 0.35) warnings.push(`상품 수익 집중: ${topProduct[0]} ${Math.round(topProductShare * 100)}%`);
  if (topWinningProductShare >= 0.50) warnings.push(`seed별 최고 수익 상품 편중: ${topWinningProduct[0]} ${Math.round(topWinningProductShare * 100)}%`);
  if (topRouteShare >= 0.30) warnings.push(`단방향 항로 집중: ${topRoute[0]} ${Math.round(topRouteShare * 100)}%`);
  if (topRoutePairShare >= 0.35) warnings.push(`왕복 항로 집중: ${topRoutePair[0]} ${Math.round(topRoutePairShare * 100)}%`);
  if (completionRate < 0.95) warnings.push(`완주율 낮음: ${Math.round(completionRate * 100)}%`);
  if (median(assets) <= STARTING_CASH) warnings.push('중앙 최종 자산이 시작 자산 이하');

  return {
    bot: botName,
    runs: results.length,
    completed,
    completionRate,
    averageFinalAssets: assets.reduce((sum, value) => sum + value, 0) / Math.max(1, assets.length),
    medianFinalAssets: median(assets),
    p10FinalAssets: percentile(assets, 0.10),
    p90FinalAssets: percentile(assets, 0.90),
    averageRealizedProfit: results.reduce((sum, row) => sum + row.stats.realizedProfit, 0) / Math.max(1, results.length),
    averageTransportCost: results.reduce((sum, row) => sum + row.stats.transportCost, 0) / Math.max(1, results.length),
    averageTrips: results.reduce((sum, row) => sum + row.stats.trips, 0) / Math.max(1, results.length),
    averageActions: results.reduce((sum, row) => sum + row.actions, 0) / Math.max(1, results.length),
    averageActionErrors: results.reduce((sum, row) => sum + row.actionErrors, 0) / Math.max(1, results.length),
    stopReasons,
    productProfit,
    productSold,
    productWins,
    routeCounts,
    routePairCounts,
    cityVisits,
    topProduct: { productId: topProduct[0], share: topProductShare },
    topWinningProduct: { productId: topWinningProduct[0], wins: topWinningProduct[1], share: topWinningProductShare },
    topRoute: { route: topRoute[0], share: topRouteShare },
    topRoutePair: { routePair: topRoutePair[0], share: topRoutePairShare },
    warnings
  };
}

function money(value) {
  return `₩${Math.round(value).toLocaleString('ko-KR')}`;
}

function printSummary(summary) {
  console.log(`\n=== ${summary.bot.toUpperCase()} BOT · ${summary.runs} runs ===`);
  console.log(`완주율        ${Math.round(summary.completionRate * 100)}%`);
  console.log(`평균 최종자산  ${money(summary.averageFinalAssets)}`);
  console.log(`중앙 최종자산  ${money(summary.medianFinalAssets)}`);
  console.log(`P10 / P90     ${money(summary.p10FinalAssets)} / ${money(summary.p90FinalAssets)}`);
  console.log(`평균 실현손익  ${money(summary.averageRealizedProfit)}`);
  console.log(`평균 운송비    ${money(summary.averageTransportCost)}`);
  console.log(`평균 이동횟수  ${summary.averageTrips.toFixed(1)}`);
  console.log(`평균 액션오류  ${summary.averageActionErrors.toFixed(1)}`);
  if (Object.keys(summary.stopReasons).length) {
    console.log(`중간 종료 사유  ${JSON.stringify(summary.stopReasons)}`);
  }

  const products = Object.entries(summary.productProfit)
    .map(([id, profit]) => ({
      상품: PRODUCTS.find((product) => product.id === id)?.name || id,
      실현손익: Math.round(profit),
      판매수량: summary.productSold[id] || 0
    }))
    .sort((a, b) => b.실현손익 - a.실현손익)
    .slice(0, 6);
  console.log('\n상품별 상위 실현손익');
  console.table(products);

  const productWins = Object.entries(summary.productWins)
    .map(([id, wins]) => ({
      상품: PRODUCTS.find((product) => product.id === id)?.name || id,
      '1위 횟수': wins,
      '1위 비율': `${Math.round((wins / Math.max(1, summary.runs)) * 100)}%`
    }))
    .sort((a, b) => b['1위 횟수'] - a['1위 횟수'])
    .slice(0, 6);
  console.log('seed별 최고 수익 상품');
  console.table(productWins);

  const routes = Object.entries(summary.routeCounts)
    .map(([route, count]) => ({ 항로: route, 이용횟수: count }))
    .sort((a, b) => b.이용횟수 - a.이용횟수)
    .slice(0, 6);
  console.log('단방향 항로 사용 상위');
  console.table(routes);

  const routePairs = Object.entries(summary.routePairCounts)
    .map(([routePair, count]) => ({
      왕복항로: routePair,
      이용횟수: count,
      비율: `${Math.round((count / Math.max(1, Object.values(summary.routeCounts).reduce((sum, value) => sum + value, 0))) * 100)}%`
    }))
    .sort((a, b) => b.이용횟수 - a.이용횟수)
    .slice(0, 6);
  console.log('왕복 항로 사용 상위');
  console.table(routePairs);

  if (summary.warnings.length) {
    console.log('밸런스 경고');
    summary.warnings.forEach((warning) => console.log(`- ${warning}`));
  } else {
    console.log('밸런스 경고 없음');
  }
}

function runBatch(options) {
  const botNames = options.bot === 'all' ? ['random', 'greedy'] : [options.bot];
  const report = {
    generatedAt: new Date().toISOString(),
    runsPerBot: options.runs,
    seedPrefix: options.seed,
    summaries: {},
    results: {}
  };

  for (const botName of botNames) {
    const results = [];
    for (let i = 0; i < options.runs; i++) {
      results.push(runSimulation({
        bot: botName,
        seed: `${options.seed}-${i}`
      }));
    }
    report.results[botName] = results;
    report.summaries[botName] = summarize(botName, results);
    if (!options.quiet) printSummary(report.summaries[botName]);
  }

  if (options.output) {
    const outputPath = path.resolve(process.cwd(), options.output);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
    if (!options.quiet) console.log(`\n리포트 저장: ${outputPath}`);
  }

  return report;
}

function printHelp() {
  console.log(`Merchant Globe balance simulator

Usage:
  node simulation/runner.js [options]

Options:
  --runs N           bot당 실행 횟수 (기본 100)
  --bot NAME         random | greedy | all (기본 all)
  --seed PREFIX      시드 prefix (기본 balance)
  --output FILE      JSON 상세 리포트 저장 경로
  --quiet            콘솔 요약 숨김
  --help, -h         도움말

Examples:
  npm run simulate
  npm run simulate -- --runs 1000 --bot greedy
  npm run simulate -- --runs 1000 --bot all --output simulation/report.json
`);
}

if (require.main === module) {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) printHelp();
  else runBatch(options);
}

module.exports = {
  parseArgs,
  createBot,
  executeAction,
  runSimulation,
  routePairKey,
  aggregateRoutePairs,
  productWinCounts,
  summarize,
  runBatch
};
