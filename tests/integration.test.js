import test from 'node:test';
import assert from 'node:assert/strict';

// Exercise the real background message boundary with Chrome APIs replaced by fakes.
test('frontend selection connects only its active tab and preserves audio controls', async () => {
  let handler, latest;
  let activeId = 11;
  const engineCommands = [], scannedTabs = [], aiRequests = [];
  const tabs = [
    { id: 11, windowId: 1, title: '롤 LCK', url: 'https://example.com/lol', audible: true },
    { id: 12, windowId: 1, title: '운영체제 강의', url: 'https://example.org/lecture', audible: true },
  ];
  const event = { addListener() {} };
  const storage = () => ({ get: async () => ({}), set: async () => {} });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert(String(url).endsWith("/suggest-profile"));
    aiRequests.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ name: "탭 맞춤 알림", summaryFocus: "중요한 안내", rules: [{ text: "중요한 일정이 확정되었을 때", enabled: true }] }) };
  };
  globalThis.chrome = {
    storage: { session: storage(), local: storage() },
    runtime: {
      onMessage: { addListener(fn) { handler = fn; } },
      async sendMessage(message) {
        if (message.to === 'ui') latest = structuredClone(message.state);
        else engineCommands.push(message);
        return { ok: true };
      },
    },
    tabs: {
      query: async query => query.active ? tabs.filter(tab => tab.id === activeId) : tabs,
      update: async id => { activeId = id; return tabs.find(tab => tab.id === id); },
      onActivated: event, onUpdated: event, onRemoved: event,
    },
    windows: { getLastFocused: async () => ({ focused: true }), update: async () => {}, onFocusChanged: event },
    offscreen: { hasDocument: async () => true },
    tabCapture: { getMediaStreamId: async ({ targetTabId }) => `stream-${targetTabId}` },
    commands: { onCommand: event },
    scripting: { executeScript: async ({ target }) => { scannedTabs.push(target.tabId); return [{ result: { description: "연결한 탭의 설명" } }]; } },
    notifications: { onButtonClicked: event },
  };
  await import('../extension/background.js');
  const send = (cmd, payload = {}) => new Promise(resolve => handler({ to: 'bg', cmd, ...payload }, {}, resolve));
  try {
    assert.equal((await send('state')).ok, true);
    assert.deepEqual(latest.available.map(tab => tab.id), [11, 12]);
    assert.equal(engineCommands.length, 0, 'opening the popup must not start capture');
    assert.equal((await send('connect', { index: 0, tabId: 12 })).ok, false, 'cannot capture the wrong tab');
    assert.equal(engineCommands.length, 0);
    assert.equal((await send('connect', { index: 0, tabId: 11 })).ok, true);
    assert.equal(latest.slots[0].tabId, 11);
    assert.equal(latest.slots[0].role, 'main');
    assert.equal(latest.slots[0].profileId, 'auto');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(latest.slots[0].alertSetup.status, 'ready');
    assert.deepEqual(scannedTabs, [11]);
    assert.equal(aiRequests[0].description, "연결한 탭의 설명");
    assert(engineCommands.some(item => item.cmd === 'listen' && item.profile?.contextOnly), 'the main tab collects context without alerts');
    assert.equal((await send('save-alerts', { index: 0, tabId: 999, profile: {} })).ok, false);
    assert.equal((await send('save-alerts', { index: 0, tabId: 11, profile: { name: '내 조건', rules: [{ text: '제출 기한이 확정되면', enabled: true }] } })).ok, true);
    assert.equal(latest.slots[0].alertSetup.edited, true);
    activeId = 12;
    assert.equal((await send('connect', { index: 0, tabId: 12 })).ok, false, 'cannot overwrite a connected slot');
    assert.equal((await send('connect', { index: 1, tabId: 12 })).ok, true);
    assert.equal((await send('connect', { index: 1, tabId: 12 })).ok, false, 'cannot capture twice');
    await send('focus', { index: 0 });
    await send('pan', { index: 0, value: -1 });
    await send('volume', { index: 0, value: 37 });
    await send('peek', { index: 1 });
    assert.equal(latest.slots[1].role, 'main');
    await send('restore');
    assert.equal(latest.slots[0].role, 'main');
    assert.equal(latest.slots[0].volumes.main, 37);
    assert.equal(latest.slots[0].pan, -1);
    await send('mute', { index: 0 });
    assert(engineCommands.some(item => item.cmd === 'output' && item.tabId === 11 && item.gain === 0));
    await send('disconnect', { index: 0 });
    assert.equal(latest.slots[0].tabId, null);
    assert(engineCommands.some(item => item.cmd === 'remove' && item.tabId === 11));
    await send('disconnect', { index: 1 });
  } finally { delete globalThis.chrome; globalThis.fetch = originalFetch; }
});
