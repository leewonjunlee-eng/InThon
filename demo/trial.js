import { AudioEngine } from "/extension/engine.js";
import { createApi } from "/extension/lib/api.js";
import { DEFAULT_SETTINGS, PROFILES, computeRoles, emptySlot, gainFor } from "/extension/lib/logic.js";

const settings = { ...DEFAULT_SETTINGS, serverUrl: location.origin };
const profile = (name) => PROFILES.find((item) => item.name === name);
const slots = [
  { ...emptySlot(), tabId: "a", topic: "롤", pan: -1, profile: profile("롤") },
  { ...emptySlot(), tabId: "b", topic: "강의", pan: 1, profile: profile("강의") },
];
const TOPICS = { lol: "롤", lecture: "강의", work: "과제" };
const moments = document.getElementById("moments");
const transcript = document.getElementById("transcript");
const lines = [];
let engine = null;

const escapeHTML = (value) => String(value).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function addCard(title, body, evidence = []) {
  if (moments.firstElementChild?.tagName === "P") moments.replaceChildren();
  moments.insertAdjacentHTML("afterbegin", `<article><h2>${escapeHTML(title)}</h2><p>${escapeHTML(body)}</p>${evidence.map((line) => `<blockquote>${escapeHTML(line)}</blockquote>`).join("")}</article>`);
}

function onEvent(event) {
  if (event.type === "transcript") {
    lines.push(`${event.time} [${event.id.toUpperCase()}] ${event.text}`);
    transcript.textContent = lines.slice(-8).join("\n");
  }
  if (event.type === "moment") {
    const { moment } = event;
    engine.chime(slots.find((slot) => slot.tabId === moment.tabId).pan);
    addCard(`${moment.time} ${moment.topic} ${moment.keyword ? `"${moment.keyword}"` : "중요한 순간"}`, moment.summary, moment.evidence);
  }
  if (event.type === "return-summary") addCard(`놓친 내용 (소리 ${event.id.toUpperCase()})`, event.summary, event.evidence);
  if (event.type === "status") addCard("상태", event.text);
}

function applyView() {
  const value = document.querySelector("[name=view]:checked").value;
  const view = { tabId: null, topic: TOPICS[value], focused: true };
  const roles = computeRoles({ slots, view, manual: null, peek: null, auto: true });
  slots.forEach((slot, i) => {
    slot.role = roles[i];
    engine.setOutput(slot.tabId, { gain: gainFor(slot, slot.role, settings), pan: slot.pan });
    engine.setListen(slot.tabId, slot.role === "standby" ? slot.profile : null, settings.sensitivity);
    const name = `role-${slot.tabId}`;
    document.getElementById(name).textContent = slot.role === "main" ? "집중 · 80%" : "대기 · 15% · 대신 듣는 중";
    document.getElementById(name).parentElement.classList.toggle("main", slot.role === "main");
  });
}

document.getElementById("start").addEventListener("click", async (event) => {
  event.target.disabled = true;
  engine = new AudioEngine({ api: createApi(async () => settings), emit: onEvent });
  for (const slot of slots) {
    const audio = document.getElementById(slot.tabId);
    await audio.play();
    await engine.add(slot.tabId, audio.captureStream());
    audio.muted = true; // 소리는 엔진 출력으로만 듣는다.
  }
  document.getElementById("work").disabled = false;
  applyView();
});
document.getElementById("work").addEventListener("change", applyView);
