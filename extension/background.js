import { savePreset, deletePreset } from "./lib/presets.js";
import { reopenPopupAfterConnect } from "./lib/popup-recovery.js";
import { createApi } from "./lib/api.js";
import { alertProfileFor, contextProfile, createAutoProfiles } from "./lib/auto-profiles.js";
import { scanConnectedTab } from "./lib/page-context.js";
import { normalizeConnection, applyBundledConnection } from "./lib/connection.js";
import { SERVER_CONFIG } from "./server-config.js";
import { DEFAULT_SETTINGS, PROFILES, classify, computeRoles, emptySlot, gainFor, hostOf, nextConnectedSlot } from "./lib/logic.js";

const STANDBY_DELAY_MS = 2000;
const NOTIFICATION_PREFIX = "moment:";
const WORK_TOPICS = ["과제", "기타"];

const initialState = () => ({
  slots: [emptySlot(), emptySlot()],
  manual: null,
  peek: null,
  snapshot: null,
  view: { tabId: null, title: "", host: "", topic: null, focused: true },
  moments: [],
  returnSummary: null,
  transcript: [],
  status: "",
  settings: { ...DEFAULT_SETTINGS },
  rules: {},
  customProfiles: [],
  topicCache: {},
  seenGuide: false,
});

let state = null;
let loading = null;
let standbyTimer = null;
let offscreenReady = null;
let alertQueue = Promise.resolve();
function queueAlert(action) {
  const result = alertQueue.catch(() => {}).then(action);
  alertQueue = result;
  return result;
}

const api = createApi(async () => (await load()).settings);

// 서비스 워커는 언제든 내려갈 수 있어 상태를 저장소에서 복구한다.
async function load() {
  if (state) return state;
  loading ??= restoreState().catch(error => { loading = null; throw error; });
  return loading;
}

async function bundledConnection() {
  if (SERVER_CONFIG.token) return SERVER_CONFIG;
  if (typeof chrome.runtime.getURL === "function") {
    try {
      const response = await fetch(chrome.runtime.getURL("private-connection.json"));
      if (response.ok) {
        const local = await response.json();
        if (local?.token && local?.serverUrl) return local;
      }
    } catch { /* Ordinary builds have no machine-local connection override. */ }
  }
  return SERVER_CONFIG;
}

async function restoreState() {
  const { session = {} } = await chrome.storage.session.get("session");
  const { saved = {} } = await chrome.storage.local.get("saved");
  const restored = { ...initialState(), ...session, ...saved };
  restored.settings = { ...DEFAULT_SETTINGS, ...restored.settings };
  const connection = await applyBundledConnection(restored.settings, await bundledConnection());
  if (connection !== restored.settings) {
    restored.settings = connection;
    await chrome.storage.local.set({ saved: { ...saved, settings: connection } });
  }
  for (const slot of restored.slots) {
    if (slot.alertSetup?.status === "generating") {
      slot.alertSetup.status = "error";
      slot.alertSetup.error = "생성이 중단됐습니다. 다시 만들어 주세요.";
    }
  }
  state = restored;
  return state;
}

async function commit() {
  const { settings, rules, customProfiles, seenGuide, ...session } = state;
  await chrome.storage.session.set({ session });
  await chrome.storage.local.set({ saved: { settings, rules, customProfiles, seenGuide } });
  const available = (await chrome.tabs.query({})).filter(tab => /^https?:/.test(tab.url || ""));
  const audible = available.filter(tab => tab.audible);
  const others = audible
    .filter((tab) => !state.slots.some((slot) => slot.tabId === tab.id))
    .map((tab) => ({ id: tab.id, title: tab.title, host: hostOf(tab.url) }));
  chrome.runtime.sendMessage({ to: "ui", state: { ...state, audible: others, available: available.map(tab => ({ id: tab.id, title: tab.title, host: hostOf(tab.url), audible: tab.audible })), profiles: profiles() } }).catch(() => {});
}

const profiles = () => [...PROFILES, ...state.customProfiles];
const topics = () => [...new Set([...profiles().map((profile) => profile.name), ...WORK_TOPICS])];
const slotIndex = (tabId) => state.slots.findIndex((slot) => slot.tabId === tabId);
const profileOf = (slot) => slot.profileId === "auto" ? alertProfileFor(slot) : profiles().find((profile) => profile.id === slot.profileId) ?? null;
const autoProfiles = createAutoProfiles({ api, slots: () => state.slots,
  readContext: scanConnectedTab,
  transcript: id => state.transcript.filter(line => line.tabId === id).map(line => line.text).join("\n"),
  publish: commit, apply: async () => { await pushOutputs(); await commit(); },
});
const generateAlerts = (index, options) => autoProfiles.generate(index, options).catch(error => {
  state.status = error.message;
  return commit();
});

// 여러 요청이 동시에 와도 문서는 하나만 만들고, 응답할 때까지 기다린다.
function ensureOffscreen() {
  offscreenReady ??= openOffscreen().finally(() => {
    offscreenReady = null;
  });
  return offscreenReady;
}

async function openOffscreen() {
  if (!(await chrome.offscreen.hasDocument())) {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["USER_MEDIA"],
      justification: "탭 소리를 조절하고 대기 중인 탭의 음성을 인식합니다.",
    });
  }
  for (let attempt = 0; attempt < 50; attempt++) {
    const reply = await chrome.runtime.sendMessage({ to: "offscreen", cmd: "ping" }).catch(() => null);
    if (reply?.ok) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("소리 엔진을 시작하지 못했습니다.");
}

async function toEngine(cmd, payload = {}) {
  await ensureOffscreen();
  const reply = await chrome.runtime.sendMessage({ to: "offscreen", cmd, ...payload });
  if (!reply?.ok) throw new Error(reply?.error ?? "엔진 응답 없음");
}

async function topicFor(tab) {
  const host = hostOf(tab.url);
  const known = classify(tab, state.rules, profiles());
  if (known) return known;
  if (!/^https?:/.test(tab.url || "")) return "기타";
  const key = `${host}|${tab.title}`;
  if (state.topicCache[key]) return state.topicCache[key];
  try {
    const { topic } = await api.classify(host, tab.title, topics());
    state.topicCache[key] = topic;
    return topic;
  } catch {
    return null; // 서버가 없으면 다른 주제로 본다.
  }
}

async function pushOutputs() {
  const { slots, settings } = state;
  if (!slots.some(slot => slot.tabId !== null)) return;
  await toEngine("duck", { on: settings.duck });
  for (const slot of slots) {
    if (slot.tabId === null) continue;
    await toEngine("output", { tabId: slot.tabId, gain: gainFor(slot, slot.role, settings), pan: slot.pan });
    const active = profileOf(slot);
    const profile = slot.profileId === "auto"
      ? contextProfile(active, slot.role !== "standby" || !active)
      : slot.role === "standby" ? active : null;
    await toEngine("listen", { tabId: slot.tabId, profile, sensitivity: settings.sensitivity, screen: settings.screen });
  }
}

// 메인으로 오르는 소리는 바로, 대기로 내려가는 소리는 2초 뒤에 적용한다.
async function applyRoles({ immediate = false } = {}) {
  clearTimeout(standbyTimer);
  const roles = computeRoles({
    slots: state.slots, view: state.view, manual: state.manual, peek: state.peek, auto: state.settings.auto,
  });
  let lowering = false;
  state.slots.forEach((slot, i) => {
    if (slot.role === "main" && roles[i] === "standby" && !immediate) lowering = true;
    else slot.role = roles[i];
  });
  if (lowering) standbyTimer = setTimeout(() => load().then(() => applyRoles({ immediate: true })), STANDBY_DELAY_MS);
  await pushOutputs();
  await commit();
}

async function refreshView() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const window = await chrome.windows.getLastFocused().catch(() => null);
  state.view = {
    tabId: tab?.id ?? null,
    title: tab?.title ?? "",
    host: hostOf(tab?.url),
    topic: tab ? await topicFor(tab) : null,
    focused: Boolean(window?.focused),
  };
}

async function connectTab(tab, index) {
  if (slotIndex(tab.id) !== -1) throw new Error("이미 연결된 탭입니다.");
  const free = index ?? state.slots.findIndex((slot) => slot.tabId === null);
  if (!Number.isInteger(free) || !state.slots[free] || state.slots[free].tabId !== null) throw new Error("슬롯이 모두 찼습니다. 하나를 해제해 주세요.");
  await ensureOffscreen();
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
  await toEngine("capture", { streamId, tabId: tab.id, screen: state.settings.screen });
  const topic = await topicFor(tab);
  state.slots[free] = {
    ...emptySlot(state.settings), tabId: tab.id, title: tab.title, host: hostOf(tab.url), topic, profileId: "auto",
  };
  await applyRoles({ immediate: true });
  void generateAlerts(free);
}

async function disconnect(index) {
  const { tabId } = state.slots[index];
  state.slots[index] = emptySlot(state.settings);
  if (state.manual === index) state.manual = null;
  if (state.peek === index) state.peek = null;
  state.snapshot = null;
  state.transcript = state.transcript.filter((line) => line.tabId !== tabId);
  if (tabId !== null) await toEngine("remove", { tabId }).catch(() => {});
  await applyRoles({ immediate: true });
}

const snapshotOf = (returnTab = null) => ({
  manual: state.manual,
  returnTab,
  slots: state.slots.map(({ tabId, pan, muted, pinned, volumes }) => ({ tabId, pan, muted, pinned, volumes: { ...volumes } })),
});

async function focusSlot(index) {
  const slot = state.slots[index];
  if (!slot || slot.tabId === null) throw new Error("연결된 탭이 없습니다.");
  await chrome.tabs.get(slot.tabId);
  const [previousTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const alreadyFocused = state.manual === index && state.peek === null && previousTab?.id === slot.tabId;
  if (!alreadyFocused || !state.snapshot) {
    state.snapshot = snapshotOf(previousTab ? { tabId: previousTab.id, windowId: previousTab.windowId } : null);
  }
  state.manual = index;
  state.peek = null;
  state.slots.forEach(item => { item.pinned = false; });
  slot.muted = false;
  await applyRoles({ immediate: true });
  const target = await chrome.tabs.update(slot.tabId, { active: true });
  await chrome.windows.update(target.windowId, { focused: true });
}

function peekSlot(index) {
  if (state.slots[index].tabId === null) return;
  state.snapshot = snapshotOf();
  state.peek = index;
}

async function restore() {
  const previous = state.snapshot;
  state.peek = null;
  state.snapshot = null;
  if (!previous) return;
  state.manual = previous.manual;
  state.slots.forEach((slot, i) => {
    const old = previous.slots[i];
    if (old && old.tabId === slot.tabId) Object.assign(slot, { pan: old.pan, muted: old.muted, pinned: old.pinned, volumes: old.volumes });
  });
  if (previous.returnTab) {
    try {
      const tab = await chrome.tabs.update(previous.returnTab.tabId, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
    } catch { /* The old tab may have closed; audio settings are still restored. */ }
  }
}

function connectedFocusTarget() {
  const current = state.manual ?? state.slots.findIndex((slot) => slot.role === "main");
  return nextConnectedSlot(state.slots, current);
}

async function clearAlerts(id = null) {
  const existing = await chrome.notifications.getAll();
  await Promise.all(Object.keys(existing).filter(key => key.startsWith(NOTIFICATION_PREFIX) && (!id || key === NOTIFICATION_PREFIX + id)).map(key => chrome.notifications.clear(key)));
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map(tab => chrome.tabs.sendMessage(tab.id, { to: "content", cmd: "moment-clear", id }).catch(() => {})));
}

function alertMoment(moment) {
  return queueAlert(() => displayMoment(moment));
}

async function displayMoment(moment) {
  const index = slotIndex(moment.tabId);
  if (index === -1 || state.settings.dnd || !state.moments.some(item => item.id === moment.id)) return;
  await clearAlerts();
  const pan = state.slots[index].pan;
  toEngine("chime", { pan }).catch(() => {});
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (state.view.focused && tab) {
    const shown = await showCard(tab.id, moment, index);
    if (shown) return;
  }
  await chrome.notifications.create(NOTIFICATION_PREFIX + moment.id, {
    type: "basic",
    iconUrl: "icon.png",
    title: `Catch Sound · ${moment.topic}`,
    message: moment.summary,
    buttons: [{ title: "여기에 집중" }, { title: "나중에" }],
    requireInteraction: true,
    priority: 2,
  });
}

async function showCard(tabId, moment, index) {
  const message = { to: "content", cmd: "moment", moment, slot: index };
  try {
    await chrome.tabs.sendMessage(tabId, message);
    return true;
  } catch {
    // 설치 전에 열린 탭에는 콘텐츠 스크립트가 없다.
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
      await chrome.tabs.sendMessage(tabId, message);
      return true;
    } catch {
      return false;
    }
  }
}

async function onEngineEvent(event) {
  if (event.type === "moment") {
    state.moments = [event.moment, ...state.moments].slice(0, 30);
    await alertMoment(event.moment);
  } else if (event.type === "moment-update") {
    const index = state.moments.findIndex(item => item.id === event.moment.id);
    if (index < 0) return;
    state.moments[index] = event.moment;
    // Update existing cards only: dismissed or replaced alerts must not reappear.
    const tabs = await chrome.tabs.query({});
    await Promise.all(tabs.map(tab => chrome.tabs.sendMessage(tab.id, {
      to: "content", cmd: "moment-update", moment: event.moment,
    }).catch(() => {})));
    await chrome.notifications.update(NOTIFICATION_PREFIX + event.moment.id, { message: event.moment.summary }).catch(() => {});
  } else if (event.type === "return-summary") {
    const index = slotIndex(event.id);
    if (index !== -1) state.returnSummary = { ...event, slot: index, title: state.slots[index].title };
  } else if (event.type === "transcript") {
    const index = slotIndex(event.id);
    if (index === -1) return;
    state.transcript = [...state.transcript, { tabId: event.id, time: event.time, text: event.text }].slice(-40);
    void Promise.resolve(autoProfiles.observe(index)).catch(() => {});
  } else if (event.type === "status") {
    state.status = event.text;
  }
  await commit();
}

async function createProfile(request) {
  const draft = await api.profile(request);
  const id = `custom-${Date.now()}`;
  return { ...draft, id, aliases: {} };
}

const commands = {
  "add-slot": () => {
    state.slots.push(emptySlot(state.settings));
    return state.slots.length - 1;
  },
  state: async () => {
    await refreshView();
    await commit();
  },
  connect: async ({ index, tabId }) => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab || (tabId !== undefined && tab.id !== tabId)) throw new Error("선택한 탭으로 이동한 뒤 확장 아이콘을 다시 눌러 연결하세요.");
    await connectTab(tab, index);
    return tab;
  },
  disconnect: ({ index }) => disconnect(index),
  focus: ({ index, tabId }) => focusSlot(tabId === undefined ? index : slotIndex(tabId)),
  peek: ({ index }) => peekSlot(index),
  switch: () => focusSlot(connectedFocusTarget()),
  restore: () => restore(),
  keep: () => {
    state.manual = state.peek;
    state.peek = null;
    state.snapshot = null;
  },
  auto: () => {
    state.manual = null;
    state.peek = null;
    state.snapshot = null;
  },
  pin: ({ index }) => {
    state.slots[index].pinned = !state.slots[index].pinned;
  },
  mute: ({ index }) => {
    state.slots[index].muted = !state.slots[index].muted;
  },
  pan: ({ index, value }) => {
    state.slots[index].pan = value;
  },
  volume: ({ index, value }) => {
    const slot = state.slots[index];
    slot.volumes[slot.role ?? "main"] = value;
  },
  goto: async ({ tabId }) => {
    const tab = await chrome.tabs.update(tabId, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  },
  pip: async ({ index }) => {
    const { tabId } = state.slots[index];
    await commands.goto({ tabId });
    await showCard(tabId, null, index).catch(() => {});
    await chrome.tabs.sendMessage(tabId, { to: "content", cmd: "pip" });
  },
  guide: () => {
    state.seenGuide = true;
  },
  dismiss: async ({ id }) => {
    state.moments = state.moments.filter((moment) => moment.id !== id);
    await queueAlert(() => clearAlerts(id));
  },
  "clear-return": () => {
    state.returnSummary = null;
  },
  "set-topic": ({ host, topic }) => {
    if (topic) state.rules[host] = topic;
    else delete state.rules[host];
    state.slots.filter((slot) => slot.host === host).forEach((slot) => {
      slot.topic = topic;
    });
    if (state.view.host === host) state.view.topic = topic;
  },
  "slot-topic": ({ index, topic }) => {
    state.slots[index].topic = topic;
  },
  "set-profile": ({ index, profileId }) => {
    const slot = state.slots[index];
    if (!slot || slot.tabId === null) throw new Error("연결된 탭이 없습니다.");
    if (profileId && profileId !== "auto" && !profiles().some(item => item.id === profileId)) throw new Error("프리셋을 찾을 수 없습니다.");
    if (profileId !== "auto" && slot.alertSetup?.status === "generating") {
      slot.alertSetup = { ...slot.alertSetup, status: slot.alertSetup.profile ? "ready" : "error", error: "자동 생성을 중단했습니다. 다시 제안받을 수 있어요." };
    }
    slot.profileId = profileId || null;
    const profile = profileOf(slot);
    if (profile) slot.topic = profile.name;
    if (profileId === "auto" && !slot.alertSetup) void generateAlerts(index);
  },
  "create-profile": ({ request }) => createProfile(request),
  "save-profile": ({ profile }) => {
    state.customProfiles = savePreset(state.customProfiles, profile);
  },
  "delete-profile": ({ id }) => {
    state.customProfiles = deletePreset(state.customProfiles, state.slots, id);
  },
  "generate-alerts": ({ index, tabId, request }) => {
    if (state.slots[index]?.tabId !== tabId) throw new Error("연결된 탭이 바뀌었습니다.");
    if (request !== undefined && typeof request !== "string") throw new Error("원하는 알림을 글로 입력해 주세요.");
    void generateAlerts(index, { request });
  },
  "save-alerts": ({ index, tabId, profile }) => {
    if (state.slots[index]?.tabId !== tabId) throw new Error("연결된 탭이 바뀌었습니다.");
    autoProfiles.save(index, profile);
  },
  settings: ({ patch }) => {
    if ("serverUrl" in patch || "token" in patch) patch = { ...patch, ...normalizeConnection({ ...state.settings, ...patch }) };
    Object.assign(state.settings, patch);
    if ("focusVol" in patch || "bgVol" in patch) {
      state.slots.forEach((slot) => {
        slot.volumes = { main: state.settings.focusVol, standby: state.settings.bgVol };
      });
    }
  },
  "test-server": () => api.checkConnection(),
  "restore-server": async () => {
    const bundle = await bundledConnection();
    if (!bundle?.token) throw new Error("공용 서버용 확장 ZIP을 설치해 주세요. 이 빌드에는 접속 토큰이 없습니다.");
    state.settings = await applyBundledConnection(state.settings, bundle, true);
    await commit();
    return api.checkConnection();
  },
};

async function run(cmd, payload) {
  await load();
  const result = await commands[cmd](payload);
  await refreshView();
  await applyRoles({ immediate: cmd !== "state" }); // 사용자가 직접 바꾼 건 기다리지 않는다.
  if (cmd === "connect" && payload.reopenPopup) await reopenPopupAfterConnect(chrome, result);
  return result;
}

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message.to !== "bg") return false;
  if (message.cmd === "config") {
    load().then((loaded) => respond(loaded.settings));
    return true;
  }
  if (message.cmd === "engine-event") {
    load().then(() => onEngineEvent(message.event)).then(() => respond({ ok: true }), () => respond({ ok: false }));
    return true;
  }
  run(message.cmd, message).then(
    (result) => respond({ ok: true, result }),
    (error) => respond({ ok: false, error: error.message }),
  );
  return true;
});

async function onViewChanged() {
  await load();
  await refreshView();
  await applyRoles();
}

chrome.tabs.onActivated.addListener(onViewChanged);
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.title || change.url || change.audible !== undefined) onViewChanged();
  if (change.title) {
    load().then(() => {
      const index = slotIndex(tabId);
      if (index !== -1) state.slots[index].title = change.title;
    });
  }
});
chrome.tabs.onRemoved.addListener(async (tabId) => {
  await load();
  const { uiSelections } = await chrome.storage.session.get("uiSelections");
  if (uiSelections?.some(source => source?.id === tabId)) {
    await chrome.storage.session.set({ uiSelections: uiSelections.map(source => source?.id === tabId ? null : source) });
  }
  await refreshView();
  const index = slotIndex(tabId);
  if (index !== -1) {
    state.status = `${index + 1}번 탭이 닫혔습니다.`;
    await disconnect(index);
  } else {
    await applyRoles({ immediate: true });
  }
});
chrome.windows.onFocusChanged.addListener(async () => {
  await onViewChanged();
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  await load();
  try {
    if (command === "connect-tab" && tab) await connectTab(tab);
    if (command === "switch-focus") await focusSlot(connectedFocusTarget());
    if (command === "restore") await restore();
  } catch (error) {
    state.status = error.message;
  }
  await refreshView();
  await applyRoles({ immediate: true });
});

chrome.notifications.onButtonClicked.addListener(async (id, button) => {
  if (!id.startsWith(NOTIFICATION_PREFIX)) return;
  await load();
  const moment = state.moments.find((item) => NOTIFICATION_PREFIX + item.id === id);
  const index = moment ? slotIndex(moment.tabId) : -1;
  if (button === 0 && index !== -1) {
    try { await run("focus", { index }); }
    catch (error) { state.status = error.message; await commit(); return; }
  }
  await chrome.notifications.clear(id);
});
