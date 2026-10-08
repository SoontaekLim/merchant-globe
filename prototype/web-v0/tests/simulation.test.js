'use strict';

const assert = require('node:assert/strict');
const { Game } = require('../game-core.js');
const { buildObservation } = require('../simulation/observation.js');
const { GreedyBot } = require('../simulation/bots/greedy-bot.js');
const { runSimulation, routePairKey, aggregateRoutePairs, productWinCounts, summarize } = require('../simulation/runner.js');

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
}

test('봇 관찰 정보는 Lv.0에서 방문하지 않은 원격 시세를 노출하지 않는다', () => {
  const game = new Game({ seed: 'bot-observation' });
  const observation = buildObservation(game);

  assert.equal(observation.cityId, 'seoul');
  assert.equal(observation.localMarket.length, 12);
  assert.equal(observation.remoteMarkets.shanghai.entries.length, 0);
  assert.equal(observation.remoteMarkets.busan.entries.length, 0);
});

test('GreedyBot은 매입 후 예약한 목적지로 이동한 뒤 판매한다', () => {
  const bot = new GreedyBot();
  const base = {
    gameOver: false,
    cityId: 'seoul',
    cash: 5000,
    cargoFree: 10,
    inventory: [],
    localMarket: [
      { productId: 'rice', trait: 'stable', cargoSize: 1, price: 100, stock: 100 }
    ],
    remoteMarkets: {
      busan: { entries: [{ productId: 'rice', price: 300, age: 0 }] }
    },
    routes: {
      busan: { destinationId: 'busan', cost: 100, days: 1 }
    }
  };

  const buy = bot.decide(base);
  assert.equal(buy.type, 'buy');
  assert.equal(buy.productId, 'rice');

  const afterBuy = {
    ...base,
    cash: 3900,
    cargoFree: 0,
    inventory: [{ productId: 'rice', qty: 10, avgCost: 100, freshness: 1, cargoSize: 1 }]
  };
  const travel = bot.decide(afterBuy);
  assert.deepEqual(travel, { type: 'travel', destinationId: 'busan', intent: 'trade', productId: 'rice' });

  const arrived = {
    ...base,
    cityId: 'busan',
    cash: 3800,
    cargoFree: 0,
    inventory: [{ productId: 'rice', qty: 10, avgCost: 100, freshness: 1, cargoSize: 1 }],
    remoteMarkets: { seoul: { entries: [{ productId: 'rice', price: 100, age: 1 }] } },
    routes: { seoul: { destinationId: 'seoul', cost: 100, days: 1 } }
  };
  const sell = bot.decide(arrived);
  assert.deepEqual(sell, { type: 'sell', productId: 'rice', quantity: 10 });
});

test('같은 시드의 GreedyBot 시뮬레이션은 동일한 결과를 만든다', () => {
  const a = runSimulation({ bot: 'greedy', seed: 'deterministic-sim' });
  const b = runSimulation({ bot: 'greedy', seed: 'deterministic-sim' });

  assert.deepEqual(a, b);
  assert.ok(a.actions > 0);
  assert.ok(Number.isFinite(a.finalAssets));
  assert.equal(a.actionErrors, 0);
});

test('RandomBot도 headless 게임을 실행할 수 있다', () => {
  const result = runSimulation({ bot: 'random', seed: 'random-smoke' });

  assert.ok(result.actions > 0);
  assert.ok(result.day >= 1 && result.day <= 30);
  assert.ok(Number.isFinite(result.finalAssets));
  assert.ok(result.stats.trips >= 0);
});

test('양방향 항로는 하나의 왕복 항로로 합산된다', () => {
  assert.equal(routePairKey('busan->fukuoka'), 'busan<->fukuoka');
  assert.equal(routePairKey('fukuoka->busan'), 'busan<->fukuoka');
  assert.deepEqual(
    aggregateRoutePairs({
      'busan->fukuoka': 30,
      'fukuoka->busan': 25,
      'seoul->busan': 10
    }),
    {
      'busan<->fukuoka': 55,
      'busan<->seoul': 10
    }
  );
});

test('각 seed에서 가장 높은 양의 실현손익 상품을 집계한다', () => {
  const counts = productWinCounts([
    { productProfit: { ginseng: 100, silk: 20 } },
    { productProfit: { ginseng: 30, silk: 80 } },
    { productProfit: { ginseng: 40, silk: -10 } },
    { productProfit: { ginseng: -5, silk: -3 } }
  ]);

  assert.deepEqual(counts, { ginseng: 2, silk: 1 });
});

test('거래 항로 집중도는 탐색/재배치 이동을 제외한다', () => {
  const summary = summarize('greedy', [
    {
      completed: true,
      stopReason: null,
      finalAssets: 12000,
      actionErrors: 0,
      actions: 4,
      stats: { realizedProfit: 2000, transportCost: 500, trips: 3 },
      productProfit: { ginseng: 2000 },
      productSold: { ginseng: 2 },
      routeCounts: {
        'busan->fukuoka': 1,
        'fukuoka->busan': 1,
        'busan->seoul': 1
      },
      tradeRouteCounts: {
        'busan->fukuoka': 1
      },
      cityVisits: { seoul: 1, busan: 2, fukuoka: 1 }
    }
  ]);

  assert.deepEqual(summary.tradeRouteCounts, { 'busan->fukuoka': 1 });
  assert.deepEqual(summary.tradeRoutePairCounts, { 'busan<->fukuoka': 1 });
  assert.equal(summary.topRoutePair.routePair, 'busan<->fukuoka');
  assert.equal(summary.topRoutePair.share, 1);
});

test('시뮬레이션 요약은 상품/항로 집중도와 완주율을 계산한다', () => {
  const results = [
    runSimulation({ bot: 'greedy', seed: 'summary-0' }),
    runSimulation({ bot: 'greedy', seed: 'summary-1' }),
    runSimulation({ bot: 'greedy', seed: 'summary-2' })
  ];
  const summary = summarize('greedy', results);

  assert.equal(summary.runs, 3);
  assert.ok(summary.completionRate >= 0 && summary.completionRate <= 1);
  assert.ok(Number.isFinite(summary.averageFinalAssets));
  assert.ok(summary.topProduct);
  assert.ok(summary.topWinningProduct);
  assert.ok(summary.topRoute);
  assert.ok(summary.topRoutePair);
  assert.ok(summary.routePairCounts);
  assert.ok(summary.tradeRouteCounts);
  assert.ok(summary.tradeRoutePairCounts);
  assert.ok(summary.productWins);
  assert.ok(Array.isArray(summary.warnings));
});

console.log('\nAll Merchant Globe simulation tests passed.');
