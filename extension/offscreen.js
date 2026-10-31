import { AudioEngine } from "./engine.js";
import { createApi } from "./lib/api.js";

const api = createApi(() => chrome.runtime.sendMessage({ to: "bg", cmd: "config" }));
const emit = (event) => chrome.runtime.sendMessage({ to: "bg", cmd: "engine-event", event }).catch(() => {});
const engine = new AudioEngine({ api, emit });
globalThis.audioFocusEngine = engine; // 개발자 도구에서 상태를 확인할 때 쓴다.

async function capture({ streamId, tabId, screen = false }) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId } },
    video: screen ? { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId, maxWidth: 640, maxHeight: 360, maxFrameRate: 2 } } : false,
  });
  await engine.add(tabId, stream);
}

const handlers = {
  ping: () => {},
  capture,
  remove: ({ tabId }) => engine.remove(tabId),
  output: ({ tabId, gain, pan }) => engine.setOutput(tabId, { gain, pan }),
  listen: ({ tabId, profile, sensitivity, screen }) => engine.setListen(tabId, profile, sensitivity, screen),
  chime: ({ pan }) => engine.chime(pan),
  duck: ({ on }) => {
    engine.duck = on;
  },
};

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message.to !== "offscreen") return false;
  Promise.resolve()
    .then(() => handlers[message.cmd](message))
    .then(() => respond({ ok: true }), (error) => respond({ ok: false, error: `${error.name}: ${error.message}` }));
  return true;
});

