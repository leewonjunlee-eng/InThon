import test from 'node:test';
import assert from 'node:assert/strict';

// Exercise the real background message boundary with Chrome APIs replaced by fakes.
test('frontend selection connects only its active tab and preserves audio controls', async () => {
  let handler, latest, shortcut, notificationClick;
  let activeId = 11;
  const engineCommands = [];
  const tabs = [
    { id: 11, windowId: 1, title: '롤 LCK', url: 'https://example.com/lol', audible: true },
    { id: 12, windowId: 1, title: '운영체제 강의', url: 'https://example.org/lecture', audible: true },
  ];
  const event = { addListener() {} };
  const storage = () => ({ get: async () => ({}), set: async () => {} });
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
      get: async id => { const tab = tabs.find(tab => tab.id === id); if (!tab) throw new Error("missing tab"); return tab; },
      query: async query => query.active ? tabs.filter(tab => tab.id === activeId) : tabs,
      update: async id => { activeId = id; return tabs.find(tab => tab.id === id); },
      onActivated: event, onUpdated: event, onRemoved: event,
    },
    windows: { getLastFocused: async () => ({ focused: true }), update: async () => {}, onFocusChanged: event },
    offscreen: { hasDocument: async () => true },
    tabCapture: { getMediaStreamId: async ({ targetTabId }) => `stream-${targetTabId}` },
    commands: { onCommand: { addListener(fn) { shortcut = fn; } } },
    notifications: { onButtonClicked: { addListener(fn) { notificationClick = fn; } }, clear: async () => {}, update: async () => false },
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
    activeId = 12;
    assert.equal((await send('connect', { index: 0, tabId: 12 })).ok, false, 'cannot overwrite a connected slot');
    assert.equal((await send('connect', { index: 1, tabId: 12 })).ok, true);
    assert.equal((await send('connect', { index: 1, tabId: 12 })).ok, false, 'cannot capture twice');
    await send('pin', { index: 1 });
    await send('mute', { index: 0 });
    await send('focus', { index: 0 });
    assert.equal(activeId, 11, 'focus must activate the target tab');
    assert.equal(latest.slots[0].muted, false);
    assert.equal(latest.slots[1].pinned, false);
    assert.equal(latest.slots[1].role, 'standby');
    assert(engineCommands.some(item => item.cmd === 'output' && item.tabId === 11 && item.gain === 0.8));
    await shortcut('switch-focus');
    assert.equal(activeId, 12, 'keyboard switch must activate the other tab');
    assert.equal(latest.slots[1].role, 'main');
    await send('focus', { tabId: 11 });
    assert.equal(activeId, 11, 'alert focus resolves the live tab, not an old slot index');
    assert.equal((await send('focus', { tabId: 999 })).ok, false);

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
  } finally { delete globalThis.chrome; }
});
