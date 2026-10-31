import test from 'node:test';
import assert from 'node:assert/strict';
import { emptySlot } from '../extension/lib/logic.js';

test('dwell suggestion reaches the page while classification and audio engine are stalled', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const beforeChrome = globalThis.chrome, beforeFetch = globalThis.fetch;
  let activate, finishClassify;
  const messages = [];
  const tab = { id: 2, title: 'Unclassified page', url: 'https://example.test/video' };
  const event = { addListener() {} };
  const session = { slots: [{ ...emptySlot(), tabId: 1, role: 'main' }, { ...emptySlot(), tabId: 2, role: 'standby' }], manual: 0 };
  globalThis.chrome = {
    storage: { session: { get: async () => ({ session }), set: async () => {} }, local: { get: async () => ({}), set: async () => {} } },
    runtime: { onMessage: event, sendMessage: async () => new Promise(() => {}) },
    offscreen: { hasDocument: async () => true },
    tabs: { query: async () => [tab], sendMessage: async (id, message) => { messages.push(message); return { ok: true, monitorReady: true }; }, onActivated: { addListener(fn) { activate = fn; } }, onUpdated: event, onRemoved: event },
    windows: { getLastFocused: async () => ({ focused: true }), onFocusChanged: event },
    commands: { onCommand: event }, notifications: { onButtonClicked: event },
  };
  globalThis.fetch = async () => new Promise(resolve => { finishClassify = () => resolve({ ok: true, json: async () => ({ topic: '기타' }) }); });
  try {
    await import('../extension/background.js');
    void activate();
    await new Promise(resolve => setImmediate(resolve));
    assert(finishClassify, 'server classification is still pending');
    t.mock.timers.tick(3000);
    await new Promise(resolve => setImmediate(resolve));
    assert(messages.some(m => m.cmd === 'focus-suggestion'), 'three-second suggestion must not wait for AI or audio engine');
  } finally { globalThis.chrome = beforeChrome; globalThis.fetch = beforeFetch; }
});
