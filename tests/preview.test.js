import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreviewTransport } from '../demo/transport.js';

test('preview preserves AI requests, focus/switch/restore, audio controls and disconnect after the merge', async () => {
  const before = Object.fromEntries(['AudioContext', 'Audio', 'location', 'fetch'].map(key => [key, globalThis[key]]));
  const node = () => ({ connect() { return this; }, disconnect() {}, gain: { setTargetAtTime() {} }, pan: { setTargetAtTime() {} }, getFloatTimeDomainData() {} });
  const stream = { getTracks: () => [], getAudioTracks: () => [], getVideoTracks: () => [] };
  globalThis.AudioContext = class {
    currentTime = 0;
    destination = node();
    resume = async () => {};
    createMediaElementSource = node;
    createMediaStreamSource = node;
    createGain = node;
    createStereoPanner = node;
    createAnalyser = node;
    createMediaStreamDestination = () => ({ ...node(), stream });
  };
  globalThis.Audio = class { play = async () => {}; pause() {} };
  globalThis.location = { origin: 'http://preview.test' };
  const requests = [];
  globalThis.fetch = async (url, options) => {
    if (url.endsWith('/health')) return { ok: true, json: async () => ({ ok: true, capabilities: ['prompt-alerts'] }) };
    requests.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ name: '맞춤 조건', rules: [{ text: '한화 경기 중 한타가 발생하면', enabled: true }] }) };
  };
  const transport = createPreviewTransport();
  let state;
  transport.subscribe(value => { state = value; });
  const send = async (cmd, value) => {
    const reply = await transport.send(cmd, value);
    assert.equal(reply.ok, true, reply.error);
    return reply;
  };
  try {
    await send('connect', { index: 0, tabId: 1 });
    await send('connect', { index: 1, tabId: 2 });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(state.slots[0].alertSetup.status, 'ready');
    await send('generate-alerts', { index: 0, tabId: 1, request: '한화 한타만 알려줘' });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(requests.at(-1).request, '한화 한타만 알려줘');
    await send('volume', { index: 0, value: 42 });
    await send('pan', { index: 0, value: -1 });
    await send('pin', { index: 1 });
    await send('mute', { index: 0 });
    await send('focus', { index: 0 });
    assert.equal(state.slots[0].muted, false);
    assert.equal(state.slots[1].pinned, false);
    await send('focus', { index: 0 });
    await send('restore');
    assert.equal(state.slots[0].muted, true);
    assert.equal(state.slots[1].pinned, true);
    await send('switch');
    assert.equal(state.slots[1].role, 'main');
    assert.equal(state.slots[0].role, 'standby');
    await send('restore');
    assert.equal(state.slots[0].volumes.main, 42);
    assert.equal(state.slots[0].pan, -1);
    assert.equal(state.slots[1].pinned, true);
    await send('save-alerts', { index: 0, tabId: 1, profile: { name: '수정 조건', rules: [{ text: '한화 갱킹', enabled: false }] } });
    assert.equal(state.slots[0].alertSetup.edited, true);
    assert.equal(state.slots[0].alertSetup.request, '한화 한타만 알려줘');
    assert.equal((await send('add-slot')).result, 2);
    await send('connect', { index: 2, tabId: 3 });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(state.slots[2].tabId, 3);
    await send('focus', { index: 1 });
    await send('switch');
    assert.equal(state.manual, 2);
    await send('switch');
    assert.equal(state.manual, 0);
    await send('add-slot');
    await send('restore');
    assert.equal(state.manual, 2);
    await send('remove-slot', { index: 0 });
    assert.equal(state.slots.length, 3);
    assert.equal(state.slots[1].tabId, 3);
    assert.equal(state.manual, 1);
    await send('remove-slot', { index: 1 });
    assert.equal(state.manual, null);
    await send('focus', { index: 0 });
    await send('pin', { index: 0 });
    await send('peek', { index: 0 });
    await send('settings', { patch: { auto: true } });
    assert.equal(state.manual, null);
    assert.equal(state.peek, null);
    assert.equal(state.snapshot, null);
    assert.equal(state.slots[0].pinned, false);

  } finally {
    for (let index = 0; index < state.slots.length; index++) {
      if (state.slots[index].tabId !== null) await transport.send('disconnect', { index });
    }
    Object.assign(globalThis, before);
  }
});
