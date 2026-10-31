import test from 'node:test';
import assert from 'node:assert/strict';

// Exercise the real background message boundary with Chrome APIs replaced by fakes.
test('frontend selection connects only its active tab and preserves audio controls', async () => {
  let handler, latest, shortcut, notificationClick, notificationClosed, tabRemoved, tabActivated;
  let activeId = 11;
  let windowFocused = true;
  let focusedWindowId = 1;
  let blockedTabId = null;
  const inboxMessages = [];
  const contentMessages = [], notifications = new Map();
  const engineCommands = [], scannedTabs = [], aiRequests = [], popupRequests = [];
  const tabs = [
    { id: 11, windowId: 1, title: '롤 LCK', url: 'https://example.com/lol', audible: true },
    { id: 12, windowId: 1, title: '운영체제 강의', url: 'https://example.org/lecture', audible: true },
  ];
  const event = { addListener() {} };
  const sessionData = {};
  const storage = () => ({ get: async () => ({}), set: async () => {} });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith('/health')) return { ok: true, json: async () => ({ ok: true, capabilities: ['prompt-alerts'] }) };
    assert(String(url).endsWith("/suggest-profile"));
    aiRequests.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ name: "탭 맞춤 알림", summaryFocus: "중요한 안내", rules: [{ text: "중요한 일정이 확정되었을 때", enabled: true }] }) };
  };
  globalThis.chrome = {
    action: { openPopup: async options => { popupRequests.push(options); } },
    storage: { session: { get: async () => structuredClone(sessionData), set: async value => Object.assign(sessionData, structuredClone(value)) }, local: storage() },
    runtime: {
      getContexts: async () => [],
      onMessage: { addListener(fn) { handler = fn; } },
      async sendMessage(message) {
        if (message.to === 'ui') latest = structuredClone(message.state);
        else engineCommands.push(message);
        return { ok: true };
      },
    },
    tabs: {
      get: async id => { const tab = tabs.find(tab => tab.id === id); if (!tab) throw new Error("missing tab"); return tab; },
      query: async query => query.active ? tabs.filter(tab => tab.id === activeId && (query.windowId === undefined || tab.windowId === query.windowId)) : tabs,
      update: async id => { activeId = id; return tabs.find(tab => tab.id === id); },
      onActivated: { addListener(fn) { tabActivated = fn; } }, onUpdated: event, onRemoved: { addListener(fn) { tabRemoved = fn; } },
      sendMessage: async (id, message) => { if (id === blockedTabId && message.cmd === "moment") throw new Error("restricted page"); (message.cmd === "dnd-inbox" ? inboxMessages : contentMessages).push({ id, ...message }); return { ok: true }; },
    },
    windows: { getLastFocused: async () => ({ id: focusedWindowId, focused: windowFocused }), update: async () => {}, onFocusChanged: event },
    offscreen: { hasDocument: async () => true },
    tabCapture: { getMediaStreamId: async ({ targetTabId }) => `stream-${targetTabId}` },
    scripting: { executeScript: async ({ target }) => { if (target.tabId === blockedTabId) throw new Error("cannot inject"); scannedTabs.push(target.tabId); return [{ result: { description: "연결한 탭의 설명" } }]; } },
    commands: { onCommand: { addListener(fn) { shortcut = fn; } } },
    notifications: { onClosed: { addListener(fn) { notificationClosed = fn; } }, onButtonClicked: { addListener(fn) { notificationClick = fn; } },
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
    assert.equal((await send('connect', { index: 0, tabId: 11, reopenPopup: true })).ok, true);
    assert.deepEqual(popupRequests, [{ windowId: 1 }], 'reopens a closed popup after successful connection');
    assert.equal(latest.slots[0].tabId, 11);
    assert.equal(engineCommands.find(item => item.cmd === 'capture').screen, false, 'default connection captures audio only');
    assert.equal(latest.slots[0].role, 'main');
    assert.equal(latest.slots[0].profileId, 'auto');
    assert.equal(latest.manual, 0, 'first connection establishes focus');
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
    assert.equal(latest.manual, 0, 'second connection preserves existing focus');
    await tabActivated();
    assert.equal(latest.manual, 0, 'viewing a standby tab preserves focus pending confirmation');
    assert.equal(latest.slots[1].role, 'standby');
    assert.equal((await send('accept-focus-suggestion', { tabId: 12 })).ok, true);
    assert.equal(latest.slots[1].role, 'main');
    await send('focus', { index: 0 });
    activeId = 12;
    await tabActivated();
    assert.equal(latest.manual, 0, 'navigation alone never accepts a focus suggestion');
    await send('settings', { patch: { auto: false } });
    await send('focus', { index: 0 });
    activeId = 12;
    await tabActivated();
    assert.equal(latest.manual, 0, 'manual mode keeps focus while browsing other tabs');
    await send('pin', { index: 0 });
    await send('peek', { index: 0 });
    await send('settings', { patch: { auto: true } });
    assert.equal(latest.manual, 0);
    assert.equal(latest.peek, null);
    assert.equal(latest.snapshot, null);
    assert.equal(latest.slots[0].pinned, false);
    assert.equal(latest.slots[1].role, 'standby', 'enabling suggestions does not change focus');
    await send('focus', { index: 0 });
    activeId = 12;

    assert.equal(latest.slots[1].role, 'standby');
    await send('auto');
    await send('pin', { index: 1 });
    await send('mute', { index: 0 });
    await send('focus', { index: 0 });
    assert.equal(activeId, 11, 'focus must activate the target tab');
    assert.equal(latest.slots[0].muted, false);
    assert.equal(latest.slots[1].pinned, false);
    assert.equal(latest.slots[1].role, 'standby');
    await send('focus', { index: 0 });
    await send('restore');
    assert.equal(activeId, 12, 'automatic-mode restore must return to the original active tab');
    assert.equal(latest.manual, null);
    assert.equal(latest.slots[1].role, 'main');
    assert.equal(latest.slots[1].pinned, true, 'restore must recover pin state changed by focus');
    assert.equal(latest.slots[0].muted, true, 'restore must recover mute state changed by focus');
    await send('focus', { index: 0 });
    assert(engineCommands.some(item => item.cmd === 'output' && item.tabId === 11 && item.gain === 0.8));
    await shortcut('switch-focus');
    assert.equal(activeId, 12, 'keyboard switch must activate the other tab');
    assert.equal(latest.slots[1].role, 'main');
    await shortcut('restore');
    assert.equal(activeId, 11, 'restore shortcut must await the old tab activation');
    await send('focus', { tabId: 11 });
    assert.equal(activeId, 11, 'alert focus resolves the live tab, not an old slot index');
    assert.equal((await send('focus', { tabId: 999 })).ok, false);

    const moment = { id: 'merged-event', tabId: 12, topic: '한화 경기', summary: '최근 자막', evidence: [], summaryStatus: 'loading' };
    await emit({ type: 'moment', moment });
    assert.equal(contentMessages.at(-1).cmd, 'moment');
    await emit({ type: 'moment-update', moment: { ...moment, summary: '완료된 요약', summaryStatus: 'ai' } });
    assert.equal(latest.moments[0].summaryStatus, 'ai');
    assert.equal(contentMessages.at(-1).cmd, 'moment-update');
    const deadline = latest.moments.find(item => item.id === moment.id).expiresAt;
    const chimes = engineCommands.filter(item => item.cmd === 'chime').length;
    tabs.push({ id: 14, windowId: 1, title: '연결하지 않은 작업 탭', url: 'https://work.example/' });
    activeId = 14;
    await tabActivated();
    assert.equal(contentMessages.at(-1).id, 14);
    assert.equal(contentMessages.at(-1).cmd, 'moment');
    assert.equal(contentMessages.at(-1).moment.summary, '완료된 요약');
    assert.equal(contentMessages.at(-1).moment.expiresAt, deadline);
    assert.equal(engineCommands.filter(item => item.cmd === 'chime').length, chimes, 'moving an alert is silent');
    activeId = 11;
    await tabActivated();
    tabs.pop();

    await send('dismiss', { id: moment.id });
    assert.equal(contentMessages.at(-1).cmd, 'moment-clear', 'dismiss closes the page card as well as history');
    const beforeDismissedUpdate = contentMessages.length;
    await emit({ type: 'moment-update', moment });
    assert.equal(contentMessages.length, beforeDismissedUpdate);
    await tabActivated();
    assert.equal(contentMessages.length, beforeDismissedUpdate, 'a dismissed alert never follows later tab visits');
    await emit({ type: 'moment', moment });
    assert.equal(contentMessages.length, beforeDismissedUpdate, 'a duplicate event cannot resurrect a dismissed alert');

    const sourceVisit = { ...moment, id: 'source-visit' };
    await emit({ type: 'moment', moment: sourceVisit });
    activeId = 12;
    await tabActivated();
    assert(!latest.moments.some(item => item.id === sourceVisit.id), 'visiting the source tab dismisses its alert');
    assert(contentMessages.some(message => message.cmd === 'moment-clear' && message.id === sourceVisit.id));
    assert(!contentMessages.some(message => message.cmd === 'moment' && message.id === 12 && message.moment.id === sourceVisit.id), 'never display the alert on its own source tab');
    activeId = 11;
    await tabActivated();
    const afterSourceVisit = contentMessages.length;
    await emit({ type: 'moment-update', moment: { ...sourceVisit, summary: '늦은 요약' } });
    await emit({ type: 'moment', moment: sourceVisit });
    assert.equal(contentMessages.length, afterSourceVisit, 'source-tab dismissal survives updates and duplicate events');
    activeId = 12;
    const chimesBeforeSource = engineCommands.filter(item => item.cmd === 'chime').length;
    await emit({ type: 'moment', moment: { ...moment, id: 'already-at-source' } });
    assert(!latest.moments.some(item => item.id === 'already-at-source'));
    assert.equal(engineCommands.filter(item => item.cmd === 'chime').length, chimesBeforeSource, 'no chime when already viewing the source');
    activeId = 11;
    await tabActivated();

    const outputsBeforeDnd = engineCommands.length;
    const fetchBeforeDnd = globalThis.fetch;
    let dndServerCalls = 0;
    globalThis.fetch = () => { dndServerCalls++; throw new Error('DND must not contact the server'); };
    const beforeInboxToggle = inboxMessages.length;
    try {
      assert.equal((await send('settings', { patch: { dnd: true } })).ok, true);
      assert.equal(engineCommands.length, outputsBeforeDnd, 'DND skips all audio engine work');
      assert.equal(dndServerCalls, 0, 'DND never contacts the server');
      const updates = inboxMessages.slice(beforeInboxToggle);
      assert.equal(updates[0].inbox.enabled, true);
      assert.equal(updates[0].inbox.countReady, false, 'show the bell without an unconfirmed count');
      assert.equal(updates.at(-1).inbox.countReady, true);
    } finally { globalThis.fetch = fetchBeforeDnd; }
    const beforeDndMoment = contentMessages.length;
    await emit({ type: 'moment', moment: { ...moment, id: 'quiet-event' } });
    assert.equal(contentMessages.length, beforeDndMoment, 'DND stores events without showing cards');
    assert.equal(latest.moments[0].id, 'quiet-event');
    assert.equal(latest.dndInbox.length, 1);
    assert.equal(inboxMessages.at(-1).inbox.enabled, true);
    assert.equal(inboxMessages.at(-1).inbox.items[0].id, 'quiet-event');
    await emit({ type: 'moment-update', moment: { ...moment, id: 'quiet-event', summary: '보완된 요약' } });
    assert.equal(latest.dndInbox[0].summary, '보완된 요약');
    const cleared = await send('clear-dnd-inbox');
    assert.deepEqual(cleared.result.items, []);
    assert.equal(latest.dndInbox.length, 0);
    await emit({ type: 'moment-update', moment: { ...moment, id: 'quiet-event' } });
    assert.equal(latest.dndInbox.length, 0, 'late summary does not resurrect cleared inbox');

    windowFocused = false;
    await send('settings', { patch: { dnd: false } });
    await emit({ type: 'moment', moment: { ...moment, id: 'system-1' } });
    assert.equal(notifications.get('moment:system-1').requireInteraction, true);
    await emit({ type: 'moment', moment: { ...moment, id: 'system-2' } });
    assert.equal(notifications.size, 2, 'a new system alert joins the one still open');
    await emit({ type: 'moment', moment: { ...moment, id: 'closed-system' } });
    await notificationClosed('moment:closed-system', true);
    assert(!latest.moments.some(item => item.id === 'closed-system'));

    windowFocused = true;
    focusedWindowId = 2;
    activeId = 13;
    tabs.push({ id: 13, windowId: 2, title: '다른 창의 페이지', url: 'https://example.net/' });
    // Deliberately omit the focus-change event: cached state still says Chrome is unfocused.
    await emit({ type: 'moment', moment: { ...moment, id: 'other-window' } });
    assert.equal(contentMessages.at(-1).cmd, 'moment');
    assert.equal(contentMessages.at(-1).id, 13, 'alert goes to the active tab in the other window');
    assert.equal(notifications.size, 2, 'stale focus state must not force a system alert');
    blockedTabId = 13;
    await emit({ type: 'moment', moment: { ...moment, id: 'restricted-page' } });
    assert(notifications.has('moment:restricted-page'), 'restricted pages fall back to system notifications');
    assert.equal(notifications.get('moment:restricted-page').title, 'CatchSound · 한화 경기');
    blockedTabId = null;
    tabs.pop();
    focusedWindowId = 1;
    activeId = 11;
    await send('settings', { patch: {} });
    await emit({ type: 'moment', moment: { ...moment, id: 'page-after-system' } });
    assert(notifications.has('moment:restricted-page'), 'a page alert leaves open system alerts in place');
    assert.equal(contentMessages.at(-1).cmd, 'moment');
    windowFocused = false;
    await send('settings', { patch: {} });
    await emit({ type: 'moment', moment: { ...moment, id: 'system-2' } });
    await notificationClick('moment:system-2', 0);
    assert.equal(activeId, 12, 'system alert focus activates the matching tab');
    assert(!notifications.has('moment:system-2'), 'the clicked alert closes');
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
    const preset = { id: 'custom-integration', name: '경기 알림', condition: '한타 시작', keywords: ['한타'] };
    assert.equal((await send('save-profile', { profile: preset })).ok, true);
    assert.equal((await send('set-profile', { index: 1, profileId: preset.id })).ok, true);
    assert.equal(latest.slots[1].profileId, preset.id);
    assert.equal((await send('save-profile', { profile: { ...preset, name: '수정한 경기' } })).ok, true);
    assert.equal(latest.profiles.filter(item => item.id === preset.id).length, 1);
    assert.equal(latest.profiles.find(item => item.id === preset.id).name, '수정한 경기');
    assert.equal((await send('delete-profile', { id: 'lol' })).ok, false);
    assert.equal((await send('delete-profile', { id: preset.id })).ok, true);
    assert.equal(latest.slots[1].profileId, null);
    assert.equal(latest.slots[1].tabId, 12);
    sessionData.uiSelections = [{ id: 11, title: '롤 LCK' }, { id: 12, title: '운영체제 강의' }];
    await send('focus', { index: 1 });
    tabs.splice(tabs.findIndex(tab => tab.id === 12), 1);
    activeId = 11;
    await tabRemoved(12);
    assert.equal(latest.slots[1].tabId, null, 'closing a connected tab clears its slot');
    assert.equal(latest.manual, null, 'closing the focused tab clears manual focus');
    assert.equal(latest.view.tabId, 11);
    assert(engineCommands.some(item => item.cmd === 'remove' && item.tabId === 12));
    assert.equal(sessionData.uiSelections[1], null, 'popup selection is cleared even with popup closed');
    assert.equal(sessionData.uiSelections[0].id, 11, 'other selections are preserved');
    tabs.splice(tabs.findIndex(tab => tab.id === 11), 1);
    await tabRemoved(11);
    assert.deepEqual(sessionData.uiSelections, [null, null], 'closing a selected but disconnected tab also clears it');
    assert.deepEqual(latest.available, [], 'popup is notified when an unconnected tab closes');
    assert.equal((await send('add-slot')).result, 2);
    assert.equal(latest.slots.length, 3);
    tabs.push(...[21, 22, 23].map(id => ({ id, windowId: 1, title: '롤 LCK', url: 'https://example.com/lol', audible: true })));
    for (let index = 0; index < 3; index++) {
      activeId = 21 + index;
      assert.equal((await send('connect', { index, tabId: activeId })).ok, true);
    }
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(latest.slots[2].tabId, 23);
    assert.equal(sessionData.session.slots.length, 3, 'added slots survive closing and reopening the popup');
    await send('focus', { index: 0 });
    await send('switch');
    assert.equal(latest.manual, 1);
    await send('switch');
    assert.equal(latest.manual, 2);
    await send('switch');
    assert.equal(latest.manual, 0);
    await send('add-slot');
    assert.equal((await send('restore')).ok, true, 'restore tolerates slots added after its snapshot');
    activeId = 23;
    assert.equal((await send('connect', { index: 3, tabId: 23 })).ok, false, 'duplicate tabs are rejected across all slots');
    tabs.splice(tabs.findIndex(tab => tab.id === 23), 1);
    activeId = 21;
    await tabRemoved(23);
    assert.equal(latest.slots[2].tabId, null);
    assert.equal(latest.slots[0].tabId, 21);
    assert.equal(latest.slots[1].tabId, 22);
    await send('focus', { index: 1 });
    sessionData.uiSelections = [{ id: 21 }, { id: 22 }, null, null];
    assert.equal((await send('remove-slot', { index: 0 })).ok, true);
    assert.equal(latest.slots.length, 3);
    assert.equal(latest.slots[0].tabId, 22);
    assert.equal(latest.manual, 0, 'focus follows the surviving tab');
    assert.equal(latest.snapshot, null);
    assert.equal(sessionData.uiSelections[0].id, 22);
    assert(engineCommands.some(item => item.cmd === 'remove' && item.tabId === 21));
    assert.equal((await send('remove-slot', { index: 99 })).ok, false);
    await send('remove-slot', { index: 0 });
    assert.equal(latest.manual, null);
    await send('remove-slot', { index: 0 });
    await send('remove-slot', { index: 0 });
    assert.equal(latest.slots.length, 0);
    assert.equal((await send('add-slot')).result, 0);
    assert.equal(latest.slots[0].tabId, null);
    windowFocused = false;
    activeId = 21;
    assert.equal((await send('connect', { index: 0, tabId: 21 })).ok, true);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(latest.manual, 0, 'connecting with no focused slot establishes focus even outside Chrome');
    assert.equal(latest.slots[0].role, 'main');

  } finally { delete globalThis.chrome; globalThis.fetch = originalFetch; }
});
