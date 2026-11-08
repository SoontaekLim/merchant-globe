'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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
  assert.ok(!html.includes('src="app.js"'));
  assert.ok(!html.includes('src="save-system.js"'));
  assert.ok(classic.includes('src="app.js"'));
  assert.ok(classic.includes('src="save-system.js"'));
  assert.ok(!classic.includes('src="realtime-app.js"'));
});

console.log('\nAll Merchant Globe realtime UI contract tests passed.');
