import test from 'node:test';
import assert from 'node:assert/strict';

// Exercise the real background message boundary with Chrome APIs replaced by fakes.
test('frontend selection connects only its active tab and preserves audio controls', async () => {
  let handler, latest, shortcut, notificationClick;
  let activeId = 11;
  let windowFocused = true;
  const contentMessages = [], notifications = new Map();
  const engineCommands = [], scannedTabs = [], aiRequests = [];
  const tabs = [
    { id: 11, windowId: 1, title: '롤 LCK', url: 'https://example.com/lol', audible: true },
    { id: 12, windowId: 1, title: '운영체제 강의', url: 'https://example.org/lecture', audible: true },
  ];
  const event = { addListener() {} };
  const storage = () => ({ get: async () => ({}), set: async () => {} });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith('/health')) return { ok: true, json: async () => ({ capabilities: ['prompt-alerts'] }) };
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
      get: async id => { const tab = tabs.find(tab => tab.id === id); if (!tab) throw new Error("missing tab"); return tab; },
      query: async query => query.active ? tabs.filter(tab => tab.id === activeId) : tabs,
      update: async id => { activeId = id; return tabs.find(tab => tab.id === id); },
      onActivated: event, onUpdated: event, onRemoved: event,
      sendMessage: async (id, message) => { contentMessages.push({ id, ...message }); return { ok: true }; },
    },
    windows: { getLastFocused: async () => ({ focused: windowFocused }), update: async () => {}, onFocusChanged: event },
    offscreen: { hasDocument: async () => true },
    tabCapture: { getMediaStreamId: async ({ targetTabId }) => `stream-${targetTabId}` },
    scripting: { executeScript: async ({ target }) => { scannedTabs.push(target.tabId); return [{ result: { description: "연결한 탭의 설명" } }]; } },
    commands: { onCommand: { addListener(fn) { shortcut = fn; } } },
    notifications: { onButtonClicked: { addListener(fn) { notificationClick = fn; } },
      getAll: async () => Object.fromEntries(notifications),
      create: async (id, value) => { notifications.set(id, value); return id; },
      clear: async id => notifications.delete(id),
      update: async (id, patch) => { if (!notifications.has(id)) return false; Object.assign(notifications.get(id), patch); return true; },
    },
  };
  await import('../extension/background.js');
  const send = (cmd, payload = {}) => new Promise(resolve => handler({ to: 'bg', cmd, ...payload }, {}, resolve));
  const emit = event => send('engine-event', { event });
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
    assert.equal((await send('generate-alerts', { index: 0, tabId: 11, request: '한화 갱과 한타만 알려줘' })).ok, true);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(aiRequests.at(-1).request, '한화 갱과 한타만 알려줘');
    assert.equal(latest.slots[0].alertSetup.request, '한화 갱과 한타만 알려줘');
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
    await send('restore');
    assert.equal(latest.slots[1].pinned, true, 'restore must recover pin state changed by focus');
    assert.equal(latest.slots[0].muted, true, 'restore must recover mute state changed by focus');
    await send('focus', { index: 0 });
    assert(engineCommands.some(item => item.cmd === 'output' && item.tabId === 11 && item.gain === 0.8));
    await shortcut('switch-focus');
    assert.equal(activeId, 12, 'keyboard switch must activate the other tab');
    assert.equal(latest.slots[1].role, 'main');
    await send('focus', { tabId: 11 });
    assert.equal(activeId, 11, 'alert focus resolves the live tab, not an old slot index');
    assert.equal((await send('focus', { tabId: 999 })).ok, false);

    const moment = { id: 'merged-event', tabId: 12, topic: '한화 경기', summary: '최근 자막', evidence: [], summaryStatus: 'loading' };
    await emit({ type: 'moment', moment });
    assert.equal(contentMessages.at(-1).cmd, 'moment');
    await emit({ type: 'moment-update', moment: { ...moment, summary: '완료된 요약', summaryStatus: 'ai' } });
    assert.equal(latest.moments[0].summaryStatus, 'ai');
    assert.equal(contentMessages.at(-1).cmd, 'moment-update');
    await send('dismiss', { id: moment.id });
    const beforeDismissedUpdate = contentMessages.length;
    await emit({ type: 'moment-update', moment });
    assert.equal(contentMessages.length, beforeDismissedUpdate);
    await send('settings', { patch: { dnd: true } });
    await emit({ type: 'moment', moment: { ...moment, id: 'quiet-event' } });
    assert.equal(contentMessages.length, beforeDismissedUpdate, 'DND stores events without showing cards');
    assert.equal(latest.moments[0].id, 'quiet-event');
    windowFocused = false;
    await send('settings', { patch: { dnd: false } });
    await emit({ type: 'moment', moment: { ...moment, id: 'system-1' } });
    assert.equal(notifications.get('moment:system-1').requireInteraction, true);
    await emit({ type: 'moment', moment: { ...moment, id: 'system-2' } });
    assert.equal(notifications.size, 1, 'new system alert replaces previous alert');
    await notificationClick('moment:system-2', 0);
    assert.equal(activeId, 12, 'system alert focus activates the matching tab');
    assert.equal(notifications.size, 0);
    windowFocused = true;
    await send('focus', { tabId: 11 });

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
