import { AudioEngine } from "../extension/engine.js";
import { createApi } from "../extension/lib/api.js";
import { DEFAULT_SETTINGS, PROFILES, emptySlot, computeRoles, gainFor } from "../extension/lib/logic.js";

// Preview uses bundled audio, never browser tabs or a microphone.
export function createPreviewTransport() {
  const available = [
    { id: 1, title: "LCK 모의 중계", host: "샘플 음원 · 롤", topic: "롤", file: "lol" },
    { id: 2, title: "운영체제 강의", host: "샘플 음원 · 강의", topic: "강의", file: "lecture" },
  ];
  const state = {
    slots: [emptySlot(), emptySlot()], manual: null, peek: null, snapshot: null,
    view: { tabId: null, title: "웹 체험 · 샘플 음원", host: "", topic: null, focused: true },
    moments: [], transcript: [], returnSummary: null, seenGuide: true,
    profiles: structuredClone(PROFILES), settings: { ...DEFAULT_SETTINGS, auto: false, serverUrl: location.origin },
    audible: available, available,
    status: "샘플 소리를 연결해 음량·좌우 방향·집중 전환을 시험하세요.",
  };
  let listener = () => {};
  let selections = [null, null];
  let engine;
  const media = new Map();
  const api = createApi(async () => state.settings);
  const publish = () => listener(structuredClone(state));
  const snapshot = () => ({ manual: state.manual, slots: structuredClone(state.slots) });
  function onEvent(event) {
    if (event.type === "status") state.status = event.text;
    if (event.type === "moment") state.moments = [event.moment, ...state.moments].slice(0, 30);
    if (event.type === "moment-update") state.moments = state.moments.map(item => item.id === event.moment.id ? event.moment : item);
    if (event.type === "transcript") state.transcript = [...state.transcript, event].slice(-40);
    if (event.type === "return-summary") {
      const slot = state.slots.findIndex(item => item.tabId === event.id);
      if (slot >= 0) state.returnSummary = { ...event, slot };
    }
    publish();
  }
  function apply() {
    const roles = computeRoles({ ...state, auto: state.settings.auto });
    state.slots.forEach((slot, i) => {
      slot.role = roles[i];
      if (slot.tabId === null || !engine) return;
      engine.setOutput(slot.tabId, { gain: gainFor(slot, slot.role, state.settings), pan: slot.pan });
      // Recognition is opt-in via a profile selection in the preview.
      const profile = state.profiles.find(item => item.id === slot.profileId);
      engine.setListen(slot.tabId, slot.role === "standby" ? profile : null, state.settings.sensitivity);
    });
    if (engine) engine.duck = state.settings.duck;
    publish();
  }
  async function connect(index, tabId) {
    if (state.slots[index]?.tabId !== null || state.slots.some(slot => slot.tabId === tabId)) throw new Error("이미 연결된 소리입니다.");
    const source = available.find(item => item.id === tabId);
    if (!source) throw new Error("소리를 다시 선택해 주세요.");
    engine ??= new AudioEngine({ api, emit: onEvent });
    await engine.context.resume();
    const audio = new Audio(`/demo/sample/${source.file}.wav`);
    audio.loop = true;
    const node = engine.context.createMediaElementSource(audio);
    const destination = engine.context.createMediaStreamDestination();
    node.connect(destination);
    try {
      await engine.add(tabId, destination.stream);
      engine.setOutput(tabId, { gain: 0, pan: 0 });
      await audio.play();
    } catch (error) {
      engine.remove(tabId);
      audio.pause();
      node.disconnect();
      throw error;
    }
    media.set(tabId, { audio, node });
    state.slots[index] = { ...emptySlot(state.settings), tabId, title: source.title, host: source.host, topic: source.topic };
    if (state.manual === null) state.manual = index;
    state.status = "샘플 음원 재생 중 · 실제 탭 캡처는 Chrome 확장에서 사용하세요.";
  }
  async function send(cmd, payload = {}) {
    const { index, value } = payload;
    const slot = state.slots[index];
    try {
      switch (cmd) {
        case "state": break;
        case "connect": await connect(index, payload.tabId); break;
        case "disconnect": {
          const item = media.get(slot.tabId);
          item?.audio.pause(); item?.node.disconnect();
          engine?.remove(slot.tabId); media.delete(slot.tabId);
          state.slots[index] = emptySlot(state.settings);
          if (state.manual === index) state.manual = null;
          state.peek = null; state.snapshot = null;
          break;
        }
        case "volume": slot.volumes[slot.role ?? "main"] = value; break;
        case "pan": slot.pan = value; break;
        case "mute": slot.muted = !slot.muted; break;
        case "pin": slot.pinned = !slot.pinned; break;
        case "focus": case "peek":
          if (slot?.tabId == null) break;
          state.snapshot = snapshot();
          if (cmd === "peek") state.peek = index;
          else { state.manual = index; state.peek = null; state.slots.forEach(item => { item.pinned = false; }); slot.muted = false; }
          break;
        case "switch": {
          const current = state.manual ?? state.slots.findIndex(item => item.role === "main");
          const next = current === 0 ? 1 : 0;
          if (state.slots[next].tabId !== null) {
            state.snapshot = snapshot(); state.manual = next; state.peek = null;
          }
          break;
        }
        case "restore": {
          const previous = state.snapshot;
          if (previous) {
            state.manual = previous.manual;
            state.slots.forEach((item, i) => {
              const old = previous.slots[i];
              if (old.tabId === item.tabId) Object.assign(item, { pan: old.pan, muted: old.muted, volumes: old.volumes });
            });
          }
          state.snapshot = null; state.peek = null;
          break;
        }
        case "keep": state.manual = state.peek; state.peek = null; state.snapshot = null; break;
        case "auto": state.manual = null; state.peek = null; state.snapshot = null; break;
        case "settings":
          Object.assign(state.settings, payload.patch);
          if ("focusVol" in payload.patch || "bgVol" in payload.patch) state.slots.forEach(item => {
            item.volumes = { main: state.settings.focusVol, standby: state.settings.bgVol };
          });
          if (payload.patch.screen) state.status = "웹 체험에는 화면 캡처가 없습니다. Chrome 확장에서 사용하세요.";
          break;
        case "set-profile": slot.profileId = payload.profileId || null; break;
        case "create-profile": return { ok: true, result: { ...await api.profile(payload.request), id: `custom-${Date.now()}`, aliases: {} } };
        case "save-profile": state.profiles.push(payload.profile); break;
        case "dismiss": state.moments = state.moments.filter(item => item.id !== payload.id); break;
        case "clear-return": state.returnSummary = null; break;
        case "goto": case "pip": state.status = "실제 탭 이동과 소형 플레이어는 Chrome 확장에서 사용할 수 있어요."; break;
        case "guide": state.seenGuide = true; break;
        default: throw new Error("웹 체험에서는 지원하지 않는 기능입니다.");
      }
      apply();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }
  return { isExtension: false, send, subscribe: callback => { listener = callback; },
    getSelections: async () => selections, saveSelections: async next => { selections = next; } };
}
