import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConnection } from '../extension/lib/connection.js';
import { createApi } from '../extension/lib/api.js';

test('shared connection configuration validates the URL without embedding credentials in it', () => {
  assert.deepEqual(normalizeConnection({ serverUrl: ' https://relay.example/api/ ', token: ' access ' }), { serverUrl: 'https://relay.example/api', token: 'access' });
  assert.throws(() => normalizeConnection({ serverUrl: 'file:///secret' }));
  assert.throws(() => normalizeConnection({ serverUrl: 'https://user:secret@relay.example' }));
  assert.throws(() => normalizeConnection({ serverUrl: 'https://relay.example/?key=secret' }));
});

test('connection check verifies cloud readiness and authenticates with only the relay token', async () => {
  const before = globalThis.fetch, calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => ({ ok: true, aiReady: true }) };
  };
  try {
    const api = createApi(async () => ({ serverUrl: 'https://relay.example/', token: 'relay-access' }));
    assert.equal((await api.checkConnection()).aiReady, true);
    assert.deepEqual(calls.map(call => call.url), ['https://relay.example/health', 'https://relay.example/check']);
    assert.equal(calls[1].options.headers['X-Demo-Token'], 'relay-access');
    assert.equal(calls[1].options.headers.Authorization, undefined);
  } finally { globalThis.fetch = before; }
});

test('connection failures explain the missing shared server or invalid token', async () => {
  const before = globalThis.fetch;
  const api = createApi(async () => ({ serverUrl: 'https://relay.example', token: 'wrong' }));
  try {
    globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
    await assert.rejects(api.checkConnection(), /공용 서버 주소/);
    globalThis.fetch = async url => url.endsWith('/health')
      ? { ok: true, json: async () => ({ ok: true, aiReady: true }) }
      : { ok: false, status: 401, json: async () => ({ error: '서버 접속 토큰이 올바르지 않습니다.' }) };
    await assert.rejects(api.checkConnection(), /접속 토큰/);
  } finally { globalThis.fetch = before; }
});
