import { createApi } from "./lib/api.js";
import { alertProfileFor, contextProfile, createAutoProfiles } from "./lib/auto-profiles.js";
import { scanConnectedTab } from "./lib/page-context.js";
import { DEFAULT_SETTINGS, PROFILES, classify, computeRoles, emptySlot, gainFor, hostOf } from "./lib/logic.js";

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
let standbyTimer = null;
let offscreenReady = null;

const api = createApi(async () => (await load()).settings);

// 서비스 워커는 언제든 내려갈 수 있어 상태를 저장소에서 복구한다.
async function load() {
  if (state) return state;
  const { session = {} } = await chrome.storage.session.get("session");
  const { saved = {} } = await chrome.storage.local.get("saved");
  state = { ...initialState(), ...session, ...saved };
  state.settings = { ...DEFAULT_SETTINGS, ...state.settings };
  for (const slot of state.slots) {
    if (slot.alertSetup?.status === "generating") {
      slot.alertSetup.status = "error";
      slot.alertSetup.error = "생성이 중단됐습니다. 다시 만들어 주세요.";
    }
  }
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
  if (![0, 1].includes(free) || state.slots[free].tabId !== null) throw new Error("슬롯이 모두 찼습니다. 하나를 해제해 주세요.");
  await ensureOffscreen();
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
  await toEngine("capture", { streamId, tabId: tab.id });
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

const snapshotOf = () => ({
  manual: state.manual,
  slots: state.slots.map(({ tabId, pan, muted, volumes }) => ({ tabId, pan, muted, volumes: { ...volumes } })),
});

function focusSlot(index) {
  if (state.slots[index].tabId === null) return;
  state.snapshot = snapshotOf();
  state.manual = index;
  state.peek = null;
}

function peekSlot(index) {
  if (state.slots[index].tabId === null) return;
  state.snapshot = snapshotOf();
  state.peek = index;
}

function restore() {
  const previous = state.snapshot;
  state.peek = null;
  state.snapshot = null;
  if (!previous) return;
  state.manual = previous.manual;
  state.slots.forEach((slot, i) => {
    const old = previous.slots[i];
    if (old.tabId === slot.tabId) Object.assign(slot, { pan: old.pan, muted: old.muted, volumes: old.volumes });
  });
}

function connectedFocusTarget() {
  const current = state.manual ?? state.slots.findIndex((slot) => slot.role === "main");
  const next = current === 0 ? 1 : 0;
  return state.slots[next].tabId !== null ? next : current;
}

async function alertMoment(moment) {
  const index = slotIndex(moment.tabId);
  if (index === -1 || state.settings.dnd) return;
  const pan = state.slots[index].pan;
  toEngine("chime", { pan }).catch(() => {});
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (state.view.focused && tab) {
    const shown = await showCard(tab.id, moment, index);
    if (shown) return;
  }
  chrome.notifications.create(NOTIFICATION_PREFIX + moment.id, {
    type: "basic",
    iconUrl: "Frame 5232.png",
    title: `소리 ${"AB"[index]} · ${moment.topic}`,
    message: moment.summary,
    buttons: [{ title: "잠깐 듣기" }, { title: "여기에 집중" }],
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
  state: async () => {
    await refreshView();
    await commit();
  },
  connect: async ({ index, tabId }) => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab || (tabId !== undefined && tab.id !== tabId)) throw new Error("선택한 탭으로 이동한 뒤 확장 아이콘을 다시 눌러 연결하세요.");
    await connectTab(tab, index);
  },
  disconnect: ({ index }) => disconnect(index),
  focus: ({ index }) => focusSlot(index),
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
  dismiss: ({ id }) => {
    state.moments = state.moments.filter((moment) => moment.id !== id);
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
    state.customProfiles = [...state.customProfiles, profile];
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
    Object.assign(state.settings, patch);
    if ("focusVol" in patch || "bgVol" in patch) {
      state.slots.forEach((slot) => {
        slot.volumes = { main: state.settings.focusVol, standby: state.settings.bgVol };
      });
    }
  },
};

async function run(cmd, payload) {
  await load();
  const result = await commands[cmd](payload);
  await refreshView();
  await applyRoles({ immediate: cmd !== "state" }); // 사용자가 직접 바꾼 건 기다리지 않는다.
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
  const index = slotIndex(tabId);
  if (index !== -1) {
    state.status = `소리 ${"AB"[index]}의 탭이 닫혔습니다.`;
    await disconnect(index);
  }
});
chrome.windows.onFocusChanged.addListener(async () => {
  await onViewChanged();
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  await load();
  try {
    if (command === "connect-tab" && tab) await connectTab(tab);
    if (command === "switch-focus") focusSlot(connectedFocusTarget());
    if (command === "restore") restore();
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
  if (index === -1) return;
  await run(button === 0 ? "peek" : "focus", { index });
  chrome.notifications.clear(id);
});
