import test from 'node:test';
import assert from 'node:assert/strict';
import { SERVER_CONFIG } from '../extension/server-config.js';

test('worker startup migrates a stale saved token and shares one initialization across concurrent requests', async () => {
  const beforeChrome = globalThis.chrome, beforeFetch = globalThis.fetch;
  let handler, latest, localReads = 0, persisted;
  const event = { addListener() {} };
  globalThis.chrome = {
    storage: {
      session: { get: async () => ({}), set: async () => {} },
      local: { get: async () => { localReads++; return { saved: { settings: { serverUrl: 'http://127.0.0.1:8787', token: 'wrong', bgVol: 23 } } }; },
        set: async value => { persisted = value; } },
    },
    runtime: { getURL: path => `chrome-extension://test/${path}`, onMessage: { addListener: fn => { handler = fn; } },
      sendMessage: async message => { if (message.to === 'ui') latest = message.state; return { ok: true }; } },
    tabs: { query: async () => [{ id: 1, title: '롤 LCK', url: 'https://example.com' }], onActivated: event, onUpdated: event, onRemoved: event },
    windows: { getLastFocused: async () => ({ focused: true }), onFocusChanged: event },
    commands: { onCommand: event }, notifications: { onButtonClicked: event },
  };
  globalThis.fetch = async (url, options) => {
    if (url === SERVER_CONFIG.serverUrl + '/health') return { ok: true, json: async () => ({ ok: true, aiReady: true }) };
    assert.equal(url, SERVER_CONFIG.serverUrl + '/check');
    assert(options.headers['X-Demo-Token'] === SERVER_CONFIG.token, 'connection check sends bundled relay token');
    return { ok: true, json: async () => ({ ok: true }) };
  };
  try {
    assert(Boolean(SERVER_CONFIG.token), 'source installation includes relay access');
    await import('../extension/background.js');
    const send = (cmd = 'state', payload = {}) => new Promise(resolve => handler({ to: 'bg', cmd, ...payload }, {}, resolve));
    const replies = await Promise.all([send(), send()]);
    assert(replies.every(reply => reply.ok));
    assert.equal(localReads, 1);
    assert.equal(latest.settings.serverUrl, SERVER_CONFIG.serverUrl);
    assert(latest.settings.token === SERVER_CONFIG.token, 'bundled token applied');
    assert.equal(latest.settings.bgVol, 23);
    assert(persisted.saved.settings.token === SERVER_CONFIG.token, 'bundled token persisted');
    assert.equal((await send('settings', { patch: { token: 'wrong-again' } })).ok, true);
    assert.equal(latest.settings.token, 'wrong-again');
    assert.equal((await send('restore-server')).ok, true);
    assert(latest.settings.token === SERVER_CONFIG.token, 'bundled token applied');
    assert(persisted.saved.settings.token === SERVER_CONFIG.token, 'bundled token persisted');
  } finally { globalThis.chrome = beforeChrome; globalThis.fetch = beforeFetch; }
});
