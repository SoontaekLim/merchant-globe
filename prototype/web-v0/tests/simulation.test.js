'use strict';

const assert = require('node:assert/strict');
const { Game } = require('../game-core.js');
const { buildObservation } = require('../simulation/observation.js');
const { GreedyBot } = require('../simulation/bots/greedy-bot.js');
const { runSimulation, summarize } = require('../simulation/runner.js');

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
  assert.deepEqual(travel, { type: 'travel', destinationId: 'busan' });

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
  assert.ok(summary.topRoute);
  assert.ok(Array.isArray(summary.warnings));
});

console.log('\nAll Merchant Globe simulation tests passed.');
