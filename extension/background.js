import { monitorSnapshot } from "./lib/monitor.js";
import { createTutorialShortcutRouter } from "./lib/tutorial-shortcuts.js";
import { createFocusSuggestion } from "./lib/focus-suggestion.js";
import { removeSlot } from "./lib/slots.js";
import { savePreset, deletePreset } from "./lib/presets.js";
import { reopenPopupAfterConnect } from "./lib/popup-recovery.js";
import { createApi } from "./lib/api.js";
import { alertProfileFor, contextProfile, createAutoProfiles } from "./lib/auto-profiles.js";
import { scanConnectedTab } from "./lib/page-context.js";
import { normalizeConnection, applyBundledConnection } from "./lib/connection.js";
import { SERVER_CONFIG } from "./server-config.js";
import { DEFAULT_SETTINGS, PROFILES, classify, computeRoles, emptySlot, gainFor, hostOf, nextConnectedSlot, pageKey } from "./lib/logic.js";

const routeTutorialShortcut = createTutorialShortcutRouter(chrome.runtime);

const STANDBY_DELAY_MS = 2000;
const NAV_SETTLE_MS = 2500; // SPA는 주소가 먼저 바뀌고 제목과 본문이 뒤따른다.
const NOTIFICATION_PREFIX = "moment:";
const ALERT_LIFETIME_MS = 15000;
const alertTimers = new Map();
const WORK_TOPICS = ["과제", "기타"];

const initialState = () => ({
  slots: [emptySlot(), emptySlot()],
  manual: null,
  peek: null,
  snapshot: null,
  view: { tabId: null, title: "", host: "", topic: null, focused: true },
  moments: [],
  dndInbox: [],
  closedAlertIds: [],
  returnSummary: null,
  transcript: [],
  trace: [],
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

function focusCandidate() {
  if (!state?.settings.auto || !state.view.focused || state.peek !== null) return null;
  const slot = state.slots.find(slot => slot.tabId === state.view.tabId && slot.role === "standby");
  return slot ? { tabId: slot.tabId, title: slot.title } : null;
}
const focusSuggestion = createFocusSuggestion({
  read: focusCandidate,
  clear: tabId => chrome.tabs.sendMessage(tabId, { to: "content", cmd: "focus-suggestion-clear" }).catch(() => {}),
  show: async candidate => {
    await refreshView({ classifyTopic: false });
    if (focusCandidate()?.tabId !== candidate.tabId) return;
    const message = { to: "content", cmd: "focus-suggestion", tabId: candidate.tabId, title: candidate.title };
    try {
      const reply = await chrome.tabs.sendMessage(candidate.tabId, message);
      if (!reply?.ok) throw new Error("알림 화면이 준비되지 않았습니다.");
    }
    catch {
      await chrome.scripting.executeScript({ target: { tabId: candidate.tabId }, files: ["inbox.js", "content.js", "status-bar.js"] });
      if (focusCandidate()?.tabId === candidate.tabId) {
        const reply = await chrome.tabs.sendMessage(candidate.tabId, message);
        if (!reply?.ok) throw new Error("알림 화면이 응답하지 않았습니다.");
      }
    }
  },
});

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
  await Promise.all(state.moments.filter(moment => moment.expiresAt && moment.expiresAt <= Date.now()).map(moment => clearAlerts(moment.id)));
  state.moments = state.moments.filter(moment => !moment.expiresAt || moment.expiresAt > Date.now());
  state.moments.filter(moment => moment.expiresAt).forEach(scheduleAlertExpiry);
  return state;
}

let monitorSignature = "";
async function syncMonitor(force = false) {
  const snapshot = monitorSnapshot(state.slots);
  const signature = JSON.stringify(snapshot);
  if (!force && signature === monitorSignature) return;
  monitorSignature = signature;
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.filter(t => /^https?:/.test(t.url || "")).map(async tab => {
    const message = { to:"monitor", snapshot };
    try {
      const response = await chrome.tabs.sendMessage(tab.id, message);
      if (response?.monitorReady || !snapshot.connected) return;
    } catch { if (!snapshot.connected) return; }
    // Tabs opened before extension installation may have no status script yet.
    try {
      await chrome.scripting.executeScript({ target:{ tabId:tab.id }, files:["inbox.js", "content.js", "status-bar.js"] });
      await chrome.tabs.sendMessage(tab.id, message);
    } catch { /* Chrome-protected pages do not allow content scripts. */ }
  }));
}
let inboxSignature = "";
const inboxState = () => ({ enabled: state.settings.dnd, items: state.dndInbox, countReady: true });
async function syncInbox(force = false, inbox = inboxState()) {
  const signature = JSON.stringify(inbox);
  if (!force && signature === inboxSignature) return;
  inboxSignature = signature;
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.filter(tab => /^https?:/.test(tab.url || "")).map(async tab => {
    const message = { to: "content", cmd: "dnd-inbox", inbox };
    try { await chrome.tabs.sendMessage(tab.id, message); }
    catch {
      if (!inbox.enabled || (!tab.active && tab.id !== state.view.tabId)) return;
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["inbox.js", "content.js", "status-bar.js"] });
        await chrome.tabs.sendMessage(tab.id, message);
      } catch { /* Chrome-protected pages cannot host the inbox. */ }
    }
  }));
}
async function commit() {
  const { settings, rules, customProfiles, seenGuide, ...session } = state;
  await chrome.storage.session.set({ session });
  await syncInbox();
  await syncMonitor();
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
    slots: state.slots, view: state.view, manual: state.manual, peek: state.peek, auto: state.settings.auto, confirmAuto: true,
  });
  let lowering = false;
  state.slots.forEach((slot, i) => {
    if (slot.role === "main" && roles[i] === "standby" && !immediate) lowering = true;
    else slot.role = roles[i];
  });
  if (lowering) standbyTimer = setTimeout(() => load().then(() => applyRoles({ immediate: true })), STANDBY_DELAY_MS);
  await pushOutputs();
  await commit();
  focusSuggestion.update();
}

let viewRevision = 0;
async function refreshView({ classifyTopic = true } = {}) {
  const revision = ++viewRevision;
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const window = await chrome.windows.getLastFocused().catch(() => null);
  if (revision !== viewRevision) return;
  state.view = {
    tabId: tab?.id ?? null,
    title: tab?.title ?? "",
    host: hostOf(tab?.url),
    topic: tab ? classify(tab, state.rules, profiles()) : null,
    focused: Boolean(window?.focused),
  };
  // Start/cancel the dwell timer from local browser state, without waiting for AI or audio.
  focusSuggestion.update();
  if (classifyTopic && tab) {
    const topic = await topicFor(tab);
    if (revision === viewRevision) state.view.topic = topic;
  }
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
    ...emptySlot(state.settings), tabId: tab.id, title: tab.title, host: hostOf(tab.url), topic, profileId: "auto", pageKey: pageKey(tab.url),
    monitor: { at:Date.now(), audio:"ready", speech:"preparing", judge:"idle", screen:"idle" },
  };
  if (!state.slots.some(slot => slot.tabId !== null && slot.role === "main")) {
    state.manual = free;
    state.peek = null;
    state.snapshot = null;
  }
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
  await syncMonitor(); // Remove closed/disconnected tabs before waiting for the audio engine.
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

function scheduleAlertExpiry(moment) {
  clearTimeout(alertTimers.get(moment.id));
  const timer = setTimeout(() => dismissMoment(moment.id).catch(() => {}), Math.max(0, moment.expiresAt - Date.now()));
  timer.unref?.();
  alertTimers.set(moment.id, timer);
}
function closeMoment(id) {
  state.closedAlertIds = [id, ...state.closedAlertIds.filter(item => item !== id)].slice(0, 250);
  state.moments = state.moments.filter(moment => moment.id !== id);
  clearTimeout(alertTimers.get(id));
  alertTimers.delete(id);
}
async function dismissMoment(id) {
  closeMoment(id);
  await queueAlert(() => clearAlerts(id));
  await commit();
}
async function moveOpenAlerts() {
  await queueAlert(async () => {
    const open = state.moments.filter(moment => moment.expiresAt);
    for (const moment of open) {
      await clearAlerts(moment.id);
      // displayMoment rechecks dismissal, deadline, and the current destination.
      await displayMoment(moment, false);
    }
  });
}

function alertMoment(moment) {
  return queueAlert(() => displayMoment(moment));
}

async function displayMoment(moment, chime = true) {
  const index = slotIndex(moment.tabId);
  if (state.settings.dnd || moment.expiresAt <= Date.now() || !state.moments.some(item => item.id === moment.id && item.expiresAt > Date.now())) return;
  // Resolve the destination at delivery time, not from delayed focus-change state.
  // The listening tab may belong to an entirely different Chrome window.
  const window = await chrome.windows.getLastFocused().catch(() => null);
  if (window?.focused) {
    const [tab] = await chrome.tabs.query({ active: true, windowId: window.id }).catch(() => []);
    if (tab) {
      if (tab.id === moment.tabId) {
        // Already inside the alert queue: dismiss directly without queueing again.
        closeMoment(moment.id);
        await clearAlerts(moment.id);
        await commit();
        return;
      }
      if (chime && index !== -1) toEngine("chime", { pan: state.slots[index].pan }).catch(() => {});
      const shown = await showCard(tab.id, moment, index);
      if (shown) return;
    }
  }
  if (chime && !window?.focused && index !== -1) toEngine("chime", { pan: state.slots[index].pan }).catch(() => {});
  await chrome.notifications.create(NOTIFICATION_PREFIX + moment.id, {
    type: "basic",
    iconUrl: "icon.png",
    title: `CatchSound · ${moment.topic}`,
    message: moment.summary,
    buttons: [{ title: "여기에 집중" }, { title: "나중에" }],
    requireInteraction: true,
    priority: 2,
  });
}

async function showCard(tabId, moment, index) {
  const message = { to: "content", cmd: "moment", moment, slot: index };
  try {
    const reply = await chrome.tabs.sendMessage(tabId, message);
    if (!reply?.ok) throw new Error("알림 화면이 준비되지 않았습니다.");
    return true;
  } catch {
    // 설치 전에 열린 탭에는 콘텐츠 스크립트가 없다.
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ["inbox.js", "content.js", "status-bar.js"] });
      const reply = await chrome.tabs.sendMessage(tabId, message);
      return Boolean(reply?.ok);
    } catch {
      return false;
    }
  }
}

async function onEngineEvent(event) {
  if (event.type === "monitor") {
    const slot = state.slots.find(s => s.tabId === event.id);
    if (slot) { slot.monitor = event.health; await chrome.storage.session.set({ session: { ...state } }); await syncMonitor(); }
    return;
  }
  if (event.type === "moment") {
    if (state.closedAlertIds.includes(event.moment.id)) return;
    const existing = state.moments.find(moment => moment.id === event.moment.id);
    const moment = { ...event.moment, expiresAt: existing?.expiresAt ?? (state.settings.dnd ? null : Date.now() + ALERT_LIFETIME_MS) };
    if (state.settings.dnd) state.dndInbox = [moment, ...state.dndInbox.filter(item => item.id !== moment.id)];
    state.moments = [moment, ...state.moments.filter(item => item.id !== moment.id)].slice(0, 30);
    if (moment.expiresAt) {
      scheduleAlertExpiry(moment);
      await commit(); // Persist the original deadline before displaying on a page.
      await alertMoment(moment);
    }
  } else if (event.type === "moment-update") {
    const inboxIndex = state.dndInbox.findIndex(item => item.id === event.moment.id);
    if (inboxIndex >= 0) state.dndInbox[inboxIndex] = { ...event.moment, expiresAt: null };
    const index = state.moments.findIndex(item => item.id === event.moment.id);
    if (index < 0) { if (inboxIndex >= 0) await commit(); return; }
    const expiresAt = state.moments[index].expiresAt;
    if (expiresAt && expiresAt <= Date.now()) return;
    state.moments[index] = { ...event.moment, expiresAt };
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
    state.transcript = [...state.transcript, { tabId: event.id, time: event.time, text: event.text }].slice(-120);
    void Promise.resolve(autoProfiles.observe(index)).catch(() => {});
  } else if (event.type === "trace") {
    state.trace = [...state.trace, { tabId: event.id, time: event.time, text: event.text }].slice(-60);
  } else if (event.type === "status") {
    state.status = event.text;
  }
  await commit();
}

async function createProfile(request) {
  const draft = await api.profile(request);
  const id = `custom-${Date.now()}`;
  return { ...draft, id, aliases: {}, keywords: [], watchPhrases: [], keywordMode: "direct" };
}

const commands = {
  "retry-monitor": async ({ tabId }) => {
    const index = slotIndex(tabId);
    if (index < 0) throw new Error("연결이 종료된 탭입니다.");
    await toEngine("retry", { tabId });
    if (state.slots[index].alertSetup?.status === "error") void generateAlerts(index);
  },
  "delete-dnd-item": async ({ id }) => {
    if (typeof id !== "string" || !state.dndInbox.some(item => item.id === id)) return inboxState();
    state.dndInbox = state.dndInbox.filter(item => item.id !== id);
    closeMoment(id);
    await commit();
    return inboxState();
  },
  "clear-dnd-inbox": async () => {
    const ids = new Set(state.dndInbox.map(item => item.id));
    state.dndInbox = [];
    state.moments = state.moments.filter(item => !ids.has(item.id));
    await commit();
    return inboxState();
  },
  "accept-focus-suggestion": async ({ tabId }) => {
    await refreshView();
    if (focusCandidate()?.tabId !== tabId) throw new Error("현재 보고 있는 대기 탭에서 다시 시도해 주세요.");
    await focusSlot(slotIndex(tabId));
  },
  "remove-slot": async ({ index }) => {
    const slot = removeSlot(state, index);
    const { uiSelections = [] } = await chrome.storage.session.get("uiSelections");
    uiSelections.splice(index, 1);
    await chrome.storage.session.set({ uiSelections });
    if (slot.tabId !== null) await toEngine("remove", { tabId: slot.tabId }).catch(() => {});
  },
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
  dismiss: ({ id }) => dismissMoment(id),
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
    if (patch.auto === true) {
      const focused = state.slots.findIndex(slot => slot.tabId !== null && slot.role === "main");
      state.manual = focused >= 0 ? focused : null;
      state.peek = null;
      state.snapshot = null;
      state.slots.forEach(slot => { slot.pinned = false; });
    }
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
  if (cmd === "delete-dnd-item") return result;
  // DND is a notification preference: never wait for classification or audio setup.
  if (cmd === "settings" && Object.keys(payload.patch ?? {}).length === 1 && "dnd" in payload.patch) {
    focusSuggestion.update();
    await syncInbox(true, { enabled: state.settings.dnd, countReady: false });
    await commit(); // Publish the confirmed local inbox count after the bell is visible.
    return result;
  }
  await refreshView();
  await applyRoles({ immediate: cmd !== "state" }); // 사용자가 직접 바꾼 건 기다리지 않는다.
  if (cmd === "connect" && payload.reopenPopup) await reopenPopupAfterConnect(chrome, result);
  return result;
}

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message.to !== "bg") return false;
  if (message.cmd === "get-monitor") {
    load().then(() => respond({ ok:true, result:monitorSnapshot(state.slots) }));
    return true;
  }
  if (message.cmd === "get-dnd-inbox") {
    load().then(() => respond({ ok: true, result: inboxState() }));
    return true;
  }
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
  await moveOpenAlerts();
  await syncInbox(true);
  await syncMonitor(true);
}

chrome.tabs.onActivated.addListener(onViewChanged);
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === "complete" && state?.view.tabId === tabId) void onViewChanged().catch(() => {});
});
const navigationTimers = new Map();

function slotNavigated(tabId, url) {
  const index = slotIndex(tabId);
  const key = pageKey(url);
  if (index === -1 || state.slots[index].pageKey === key) return;
  state.slots[index].pageKey = key;
  clearTimeout(navigationTimers.get(tabId));
  navigationTimers.set(tabId, setTimeout(() => refreshNavigatedSlot(tabId).catch(() => {}), NAV_SETTLE_MS));
}

async function refreshNavigatedSlot(tabId) {
  await load();
  navigationTimers.delete(tabId);
  const index = slotIndex(tabId);
  if (index === -1) return;
  const tab = await chrome.tabs.get(tabId);
  Object.assign(state.slots[index], { title: tab.title, host: hostOf(tab.url), topic: await topicFor(tab) });
  state.transcript = state.transcript.filter(line => line.tabId !== tabId); // 이전 페이지의 말을 새 조건에 섞지 않는다.
  await autoProfiles.navigated(index);
  await applyRoles();
}

chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.title || change.url || change.audible !== undefined) onViewChanged();
  if (change.url) load().then(() => slotNavigated(tabId, change.url));
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
  if (routeTutorialShortcut(command)) return;
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
  if (moment) await dismissMoment(moment.id);
  else await chrome.notifications.clear(id);
});
chrome.notifications.onClosed?.addListener(async (id, byUser) => {
  if (!byUser || !id.startsWith(NOTIFICATION_PREFIX)) return;
  await load();
  await dismissMoment(id.slice(NOTIFICATION_PREFIX.length));
});
