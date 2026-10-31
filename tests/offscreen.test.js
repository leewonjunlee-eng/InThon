import test from 'node:test';
import assert from 'node:assert/strict';

test('default capture requests only audio, while explicit screen mode retains video capture', async () => {
  const previousChrome = globalThis.chrome, previousAudio = globalThis.AudioContext;
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const previousEngine = globalThis.audioFocusEngine;
  let handler;
  const requests = [], added = [];
  const stream = {};
  globalThis.chrome = { runtime: { onMessage: { addListener: fn => { handler = fn; } }, sendMessage: async () => ({}) } };
  globalThis.AudioContext = class {};
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: async constraints => { requests.push(constraints); return stream; } } } });
  try {
    await import('../extension/offscreen.js');
    globalThis.audioFocusEngine.add = async (id, value) => { added.push({ id, value }); };
    const capture = payload => new Promise(resolve => handler({ to: 'offscreen', cmd: 'capture', streamId: 'test-stream', tabId: 11, ...payload }, {}, resolve));
    assert.deepEqual(await capture({}), { ok: true });
    assert.equal(requests[0].video, false);
    assert.equal(requests[0].audio.mandatory.chromeMediaSource, 'tab');
    assert.deepEqual(added[0], { id: 11, value: stream });
    assert.deepEqual(await capture({ screen: true }), { ok: true });
    assert.equal(requests[1].video.mandatory.chromeMediaSourceId, 'test-stream');
  } finally {
    globalThis.chrome = previousChrome;
    globalThis.AudioContext = previousAudio;
    globalThis.audioFocusEngine = previousEngine;
    if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator);
    else delete globalThis.navigator;
  }
});
