'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Core = require('../game-core.js');
const Realtime = require('../realtime-core.js');
const MarketDecision = require('../market-decision.js');
const TradeUX = require('../trade-ux.js');
const RemoteComparison = require('../remote-comparison.js');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'realtime-app.js'), 'utf8');
const classic = fs.readFileSync(path.join(root, 'classic.html'), 'utf8');

function test(name, fn) {
  try { fn(); console.log('✓ ' + name); }
  catch (error) { console.error('✗ ' + name); throw error; }
}

test('실시간 앱에서 조회하는 모든 요소 ID는 기본 HTML에 존재한다', () => {
  const ids = [...app.matchAll(/\bel\(['"]([a-zA-Z][a-zA-Z0-9_-]*)['"]\)/g)].map((m) => m[1]);
  assert.ok(ids.length > 30);
  for (const id of new Set(ids)) {
    assert.ok(html.includes('id="' + id + '"'), 'Missing realtime HTML element: ' + id);
  }
});

test('실시간 진입점과 30일 클래식은 서로 다른 엔트리 스크립트를 사용한다', () => {
  assert.ok(html.includes('src="realtime-core.js"'));
  assert.ok(html.includes('src="realtime-app.js"'));
  assert.ok(html.includes('src="market-decision.js"'));
  assert.ok(html.indexOf('src="market-decision.js"') < html.indexOf('src="realtime-app.js"'));
  assert.ok(html.includes('src="remote-comparison.js"'));
  assert.ok(html.indexOf('src="remote-comparison.js"') < html.indexOf('src="realtime-app.js"'));
  assert.ok(!html.includes('src="app.js"'));
  assert.ok(!html.includes('src="save-system.js"'));
  assert.ok(classic.includes('src="app.js"'));
  assert.ok(classic.includes('src="save-system.js"'));
  assert.ok(!classic.includes('src="realtime-app.js"'));
});

function launchApp() {
  const elements = new Map();
  const storage = new Map();
  const downloads = [];
  let tick;
  let now = 100000;
  function element() {
    const listeners = {};
    return {
      style: {}, value: '', disabled: false,
      addEventListener(type, listener) { listeners[type] = listener; },
      dispatch(type) { listeners[type](); },
      append() {}, appendChild() {}, replaceChildren() {}, click() {}, remove() {},
      querySelector: element
    };
  }
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, element());
      return elements.get(id);
    },
    createElement: element,
    querySelectorAll: () => [],
    addEventListener() {},
    body: element()
  };
  document.getElementById('speedSelect').value = '60000';
  document.getElementById('marketSort').value = 'default';
  vm.runInNewContext(app, {
    window: {
      MerchantGlobeCore: Core, MerchantGlobeRealtime: Realtime, MerchantGlobeTradeUX: TradeUX,
      MerchantGlobeMarketDecision: MarketDecision, MerchantGlobeRemoteComparison: RemoteComparison,
      setInterval(callback) { tick = callback; }
    },
    document,
    Date: class extends Date { static now() { return now; } },
    Blob,
    URL: {
      createObjectURL(blob) { downloads.push(blob); return 'blob:play-report'; },
      revokeObjectURL() {}
    },
    setTimeout(callback) { callback(); },
    localStorage: {
      getItem: (key) => storage.get(key),
      setItem: (key, value) => storage.set(key, value)
    }
  });
  return {
    setTime: (value) => { now = value; },
    tick, downloads, elements,
    saved: () => JSON.parse(storage.get('merchant-globe.realtime.save.v1'))
  };
}

test('긴 공백 직후 거래·속도 변경·내보내기는 같은 복구 제한을 적용한다', () => {
  for (const [id, event] of [['upgradeCargoBtn', 'click'], ['speedSelect', 'change'], ['exportBtn', 'click']]) {
    const page = launchApp();
    const target = 100000 + 600 * 60000;
    page.setTime(target);
    const button = page.elements.get(id);
    if (id === 'speedSelect') button.value = '10000';
    button.dispatch(event);
    const partial = page.saved();
    assert.equal(partial.checkpoint.economy.day, 251);
    assert.equal(partial.checkpoint.economy.cash, 10000);
    assert.equal(partial.activeMsPerDay, 60000);
    assert.equal(partial.recoveryTargetMs, target);
    assert.equal(page.downloads.length, 0);
    assert.equal(page.elements.get('exportBtn').disabled, true);
    assert.equal(page.elements.get('speedSelect').disabled, true);

    page.setTime(100000);
    page.tick();
    page.tick();
    assert.equal(page.saved().checkpoint.economy.day, 601);
    assert.equal(page.elements.get('exportBtn').disabled, false);
    assert.equal(page.elements.get('speedSelect').disabled, false);
    page.elements.get('exportBtn').dispatch('click');
    assert.equal(page.downloads.length, 1);
  }
});

test('상품 정렬을 바꾸어도 시장 경제·현금·화물·저장 행동을 변경하지 않는다', () => {
  const page = launchApp();
  const before = page.saved();
  const select = page.elements.get('marketSort');
  for (const mode of ['range-low', 'day-drop', 'default']) {
    select.value = mode;
    select.dispatch('change');
    assert.equal(page.elements.get('marketSortHelp').textContent.length > 0, true);
  }
  assert.deepEqual(page.saved(), before);
});

test('원격 비교 선택 변경은 미확인 시세를 공개하거나 저장을 변경하지 않는다', () => {
  const page = launchApp();
  const before = page.saved();
  const area = page.elements.get('remoteCompareList');
  assert.ok(area.innerHTML.includes('미확인 시세'));
  assert.ok(!area.innerHTML.includes('추정 손익'));
  const product = page.elements.get('compareProduct');
  product.value = 'fish';
  product.dispatch('change');
  const mode = page.elements.get('compareMode');
  mode.value = 'held';
  mode.dispatch('change');
  assert.ok(page.elements.get('compareSummary').textContent.includes('보유 수량 부족'));
  const qty = page.elements.get('compareQty');
  qty.value = '2';
  qty.dispatch('input');
  assert.ok(page.elements.get('compareSummary').textContent.includes('2개'));
  assert.deepEqual(page.saved(), before);
});

test('오프라인 복구 중 원격 비교는 숨기고 입력을 잠근다', () => {
  const page = launchApp();
  page.setTime(100000 + 600 * 60000);
  page.tick();
  assert.equal(page.elements.get('remoteCompareList').innerHTML, '');
  assert.equal(page.elements.get('compareProduct').disabled, true);
  page.tick();
  page.tick();
  assert.equal(page.elements.get('compareProduct').disabled, false);
  assert.ok(page.elements.get('remoteCompareList').innerHTML.length > 0);
});

console.log('\nAll Merchant Globe realtime UI contract tests passed.');
