import test from 'node:test';
import assert from 'node:assert/strict';
import { pageKey } from '../extension/lib/logic.js';

test('only a real page change counts as navigation', () => {
  const watch = 'https://www.youtube.com/watch?v=a';
  assert.equal(pageKey(watch + '&t=90'), pageKey(watch));
  assert.equal(pageKey(watch + '#comments'), pageKey(watch));
  assert.notEqual(pageKey('https://www.youtube.com/watch?v=b'), pageKey(watch));
});

test('a connected tab that moves to a new page gets fresh AI conditions without its old speech', async () => {
  const before = { chrome: globalThis.chrome, fetch: globalThis.fetch, setTimeout: globalThis.setTimeout };
  const realTimeout = globalThis.setTimeout;
  const event = { addListener() {} };
  const slot = { tabId: 7, title: '이전 영상', host: 'youtube.com', topic: null, profileId: 'auto', pageKey: pageKey('https://www.youtube.com/watch?v=a'),
    pan: 0, volumes: { main: 80, standby: 15 }, alertSetup: { status: 'ready', startedAt: 1, refinements: 2, profile: { name: '이전', rules: [{ text: '이전 조건', enabled: true }] } } };
  const session = { slots: [slot, { tabId: null }], manual: 0, peek: null, transcript: [{ tabId: 7, text: '이전 영상의 말' }, { tabId: 8, text: '다른 탭의 말' }] };
  let updated, handler, stored;
  const requests = [];
  let tab = { id: 7, title: '새 영상', url: 'https://www.youtube.com/watch?v=b' };
  globalThis.chrome = {
    storage: { session: { get: async () => ({ session }), set: async value => { stored = value.session; } }, local: { get: async () => ({}), set: async () => {} } },
    runtime: { getURL: path => `chrome-extension://test/${path}`, onMessage: { addListener: fn => { handler = fn; } }, sendMessage: async () => ({ ok: true }) },
    tabs: { query: async () => [tab], get: async () => tab, onActivated: event, onUpdated: { addListener: fn => { updated = fn; } }, onRemoved: event },
    windows: { getLastFocused: async () => ({ focused: true }), onFocusChanged: event },
    offscreen: { hasDocument: async () => true },
    scripting: { executeScript: async () => [{ result: { title: '새 영상', description: '새 설명' } }] },
    commands: { onCommand: event }, notifications: { onButtonClicked: event },
  };
  globalThis.setTimeout = (fn, _ms, ...args) => realTimeout(fn, 0, ...args);
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith('/suggest-profile')) {
      requests.push(JSON.parse(options.body));
      return { ok: true, json: async () => ({ name: '새 영상 알림', summaryFocus: '', rules: [{ text: '새 조건', enabled: true }] }) };
    }
    if (String(url).endsWith('/classify')) return { ok: true, json: async () => ({ topic: '기타' }) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  try {
    await import('../extension/background.js');
    await new Promise(resolve => handler({ to: 'bg', cmd: 'state' }, {}, resolve));
    updated(7, { url: 'https://www.youtube.com/watch?v=a&t=30' });
    await new Promise(resolve => realTimeout(resolve, 30));
    assert.equal(requests.length, 0, 'moving inside the same video is not a new page');
    updated(7, { url: tab.url });
    await new Promise(resolve => realTimeout(resolve, 60));
    assert.equal(requests.length, 1);
    assert.equal(requests[0].title, '새 영상');
    assert.equal(requests[0].text, '', 'speech from the previous page is dropped');
    assert.equal(stored.slots[0].alertSetup.profile.rules[0].text, '새 조건');
    assert.deepEqual(stored.transcript.map(line => line.tabId), [8], 'other tabs keep their speech');
  } finally { Object.assign(globalThis, before); }
});
