import test from 'node:test';
import assert from 'node:assert/strict';

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
  globalThis.fetch = async url => {
    if (url === 'https://relay.example/health') return { ok: true, json: async () => ({ ok: true, aiReady: true }) };
    if (url === 'https://relay.example/check') return { ok: true, json: async () => ({ ok: true }) };
    assert.equal(url, 'chrome-extension://test/private-connection.json');
    return { ok: true, json: async () => ({ serverUrl: 'https://relay.example', token: 'correct-access' }) };
  };
  try {
    await import('../extension/background.js');
    const send = (cmd = 'state', payload = {}) => new Promise(resolve => handler({ to: 'bg', cmd, ...payload }, {}, resolve));
    const replies = await Promise.all([send(), send()]);
    assert(replies.every(reply => reply.ok));
    assert.equal(localReads, 1);
    assert.equal(latest.settings.serverUrl, 'https://relay.example');
    assert.equal(latest.settings.token, 'correct-access');
    assert.equal(latest.settings.bgVol, 23);
    assert.equal(persisted.saved.settings.token, 'correct-access');
    assert.equal((await send('settings', { patch: { token: 'wrong-again' } })).ok, true);
    assert.equal(latest.settings.token, 'wrong-again');
    assert.equal((await send('restore-server')).ok, true);
    assert.equal(latest.settings.token, 'correct-access');
    assert.equal(persisted.saved.settings.token, 'correct-access');
  } finally { globalThis.chrome = beforeChrome; globalThis.fetch = beforeFetch; }
});
