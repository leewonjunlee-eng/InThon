import { createTransport } from "../lib/transport.js";
const transport = await createTransport();
if (transport.isExtension) document.documentElement.classList.add("extension-popup");
let selections = await transport.getSelections();
let picker = null;
let pending = null;
const root = document.getElementById("ab-mock");
const main = document.getElementById("ab-content");
let state = null;
let tab = "sound";
let notice = "";
let draft = null;
let busy = false;
const connecting = new Set();

const escapeHTML = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const label = (i) => ["A", "B"][i];
const ROLE = { main: "메인", standby: "대기" };

function button(text, action, cls = "", disabled = false, extra = "") {
  return `<button type="button" class="${cls}" data-action="${action}" ${disabled ? "disabled" : ""} ${extra}>${text}</button>`;
}
function toggle(name, text) {
  return `<label class="check"><input type="checkbox" data-setting="${name}" ${state.settings[name] ? "checked" : ""}> ${text}</label>`;
}
function send(cmd, payload = {}) {
  return transport.send(cmd, payload);
}
async function act(cmd, payload) {
  let reply;
  try { reply = await send(cmd, payload); }
  catch (error) { reply = { ok: false, error: error.message }; }
  if (!reply?.ok) {
    notice = reply?.error ?? "요청을 처리하지 못했어요.";
    render();
  }
  return reply;
}

function renderGuide() {
  return `<div class="notice"><h3>필요한 소리에 집중하고, 다시 돌아오세요.</h3><p>1. 소리가 나는 탭에서 이 창을 열고 연결합니다.</p><p>2. 맡기기에서 무엇을 대신 들을지 고릅니다.</p><p>3. 다른 일을 하면 소리는 줄고, 중요한 순간에 알려 드려요.</p>${button("시작하기", "guide", "solid full")}</div>`;
}

function renderEmptySlot(i) {
  const source = selections[i];
  if (!source) return `<p class="sub">이 자리에 들을 소리를 넣어주세요.</p>${button("＋ 연결할 탭 고르기", `pick:${i}`, "full")}`;
  const current = !transport.isExtension || source.id === state.view.tabId;
  return `<div class="source"><strong>${escapeHTML(source.title)}</strong><span class="sub">${escapeHTML(source.host)}</span></div><div class="two">${button("다른 탭 선택", `pick:${i}`)}${button(current ? `${label(i)} 연결하기` : "선택한 탭으로 이동 ↗", current ? `connect:${i}` : `goto:${source.id}`, "solid", connecting.has(i))}</div>${button("선택 지우기", `clear:${i}`, "quiet")}${!current ? '<p class="sub">선택한 탭으로 이동한 뒤 확장 아이콘을 다시 눌러 연결하세요.</p>' : ''}`;
}

function renderPicker() {
  const i = picker;
  const sources = state.available ?? state.audible;
  let html = button("← 슬롯으로 돌아가기", "back", "quiet") + `<div class="row"><h3>${label(i)}에 연결할 소리 선택</h3><span class="letter">${label(i)}</span></div><p class="sub">탭을 선택한 뒤 아래 버튼으로 확정하세요.</p><div class="picker">`;
  for (const source of sources) {
    const used = state.slots[1-i].tabId === source.id || selections[1-i]?.id === source.id;
    html += button(`<span>${escapeHTML(source.title)}<span class="sub">${escapeHTML(source.host)}${source.audible ? " · 재생 중" : ""}</span></span><span class="sub">${used ? "다른 슬롯에서 사용 중" : pending === source.id ? "선택됨" : "선택"}</span>`, `select:${source.id}`, "choice", used, `aria-pressed="${pending === source.id}"`);
  }
  if (!sources.length) html += '<p class="sub">연결할 웹 탭이 없습니다. 먼저 동영상이나 음악 탭을 열어주세요.</p>';
  return html + `</div>${button(`${label(i)} 슬롯에 선택하기`, "confirm", "solid full", pending === null)}<div class="notice">선택만으로 소리가 연결되지는 않아요. Chrome에서는 선택한 탭에서 확장 아이콘을 눌러 연결합니다.</div>`;
}

function renderSlot(slot, i) {
  const connected = slot.tabId !== null;
  const main = slot.role === "main";
  const focused = (state.peek ?? state.manual) === i;
  let html = `<article class="slot ${connected ? "" : "empty"} ${main ? "focus-card" : ""}" aria-label="소리 ${label(i)}"><div class="row"><div class="row"><span class="letter">${label(i)}</span><h3>소리 ${label(i)}</h3></div><span class="badge ${main ? "focus-badge" : ""}">${connected ? `${ROLE[slot.role] ?? "연결됨"}${slot.pinned ? " · 고정" : ""}` : selections[i] ? "선택됨 · 연결 전" : "비어 있음"}</span></div>`;
  if (!connected) return html + renderEmptySlot(i) + "</article>";
  const volume = slot.volumes[slot.role ?? "main"];
  html += `<div class="source"><strong>${escapeHTML(slot.title)}</strong><span class="sub">${escapeHTML(slot.host)} · 주제 ${escapeHTML(slot.topic ?? "미분류")}</span></div>`;
  html += `<label><span class="row"><span>${ROLE[slot.role] ?? ""} 볼륨</span><output id="volume-${i}">${volume}%${slot.muted ? " · 음소거" : ""}</output></span><input type="range" min="0" max="100" step="1" value="${volume}" data-volume="${i}" aria-label="소리 ${label(i)} 볼륨"></label>`;
  html += `<div class="segments" role="group" aria-label="소리 ${label(i)} 출력 방향">${[-1, 0, 1].map((p, k) => button(["왼쪽", "양쪽", "오른쪽"][k], `pan:${i}:${p}`, "", false, `aria-pressed="${slot.pan === p}"`)).join("")}</div>`;
  html += `<div class="two">${button(focused ? "집중 중" : "여기에 집중", `focus:${i}`, focused ? "solid" : "", focused)}${button(slot.muted ? "소리 켜기" : "듣기 음소거", `mute:${i}`, "", false, `aria-pressed="${slot.muted}"`)}</div>`;
  html += `<div class="two">${button(slot.pinned ? "고정 해제" : "메인 고정", `pin:${i}`, "", false, `aria-pressed="${slot.pinned}"`)}${button("잠깐 확인", `peek:${i}`, "", state.peek !== null || main)}</div>`;
  html += `<div class="row">${button("탭으로 이동 ↗", `goto:${slot.tabId}`, "quiet")}${button("소형 플레이어", `pip:${i}`, "quiet")}${button("연결 해제", `stop:${i}`, "quiet")}</div>`;
  return html + "</article>";
}

function renderView() {
  const { view } = state;
  const where = !view.focused ? "크롬 밖에서 작업 중" : `${escapeHTML(view.title).slice(0, 26)}`;
  const topics = [...new Set([...state.profiles.map((item) => item.name), "과제", "기타"])];
  const options = topics.map((topic) => `<option ${view.topic === topic ? "selected" : ""}>${escapeHTML(topic)}</option>`).join("");
  return `<div class="source"><span class="sub">지금 보는 화면</span><strong>${where}</strong>${view.focused && view.host ? `<label class="sub">이 사이트의 주제 <select data-topic="${escapeHTML(view.host)}"><option value="">자동</option>${options}</select></label>` : ""}</div>`;
}

function renderSound() {
  const connected = state.slots.filter((slot) => slot.tabId !== null).length;
  let html = "";

  html += `<div class="row"><h3>내 소리 구성</h3><span class="sub">${connected} / 2 연결됨</span></div>`;
  html += renderView();
  if (state.returnSummary) html += renderReturn();
  if (state.peek !== null) {
    html += `<div class="notice"><h3>${label(state.peek)}를 잠깐 확인 중</h3><div class="two">${button("확인 끝 · 복귀", "restore", "solid")}${button("계속 집중", "keep")}</div></div>`;
  }
  html += state.slots.map(renderSlot).join("");
  if (connected) {
    html += `<div class="footer-actions">${button("다른 소리에 집중", "switch", "full", connected < 2)}${button("이전 상태로 복귀", "restore", "full", !state.snapshot)}${button("자동 전환으로 돌아가기", "auto", "full", state.manual === null)}</div>`;
  }
  return html;
}

function renderReturn() {
  const item = state.returnSummary;
  return `<div class="notice"><h3>놓친 내용 · 소리 ${label(item.slot)} (${item.minutes}분)</h3><p>${escapeHTML(item.summary)}</p>${button("확인", "clear-return", "quiet")}</div>`;
}

function renderProfileSelect(slot, i) {
  const options = state.profiles.map((item) => `<option value="${escapeHTML(item.id)}" ${slot.profileId === item.id ? "selected" : ""}>${escapeHTML(item.name)}</option>`).join("");
  return `<label class="stack"><span>소리 ${label(i)} · ${escapeHTML(slot.title).slice(0, 20)}</span><select data-profile="${i}"><option value="">대신 듣지 않음</option>${options}</select></label>`;
}

function renderEntrust() {
  const connected = state.slots.map((slot, i) => (slot.tabId !== null ? renderProfileSelect(slot, i) : "")).join("");
  let html = `<h3>무엇을 맡길까요?</h3><p class="sub">대기 중인 탭만 대신 듣습니다. 음성은 저장하지 않고, 자막은 탭을 닫으면 지워집니다.</p>`;
  html += connected || `<div class="notice">먼저 소리 탭에서 연결해 주세요.</div>`;
  html += `<label class="stack"><span>조건을 한 줄로 적기</span><input type="text" id="request" maxlength="200" placeholder="두산 득점하면 알려줘"></label>${button(busy ? "만드는 중…" : "프로필 만들기", "draft", "full", busy)}`;
  if (draft) {
    html += `<div class="notice"><h3>${escapeHTML(draft.name)}</h3><p>조건: ${escapeHTML(draft.condition)}</p><p>단어: ${escapeHTML(draft.keywords.join(", "))}</p><p>요약 초점: ${escapeHTML(draft.summaryFocus)}</p><div class="two">${button("저장", "save-draft", "solid")}${button("취소", "drop-draft")}</div></div>`;
  }
  const { settings } = state;
  html += `<h3>설정</h3><div class="stack">${toggle("auto", "보는 화면에 따라 자동 전환")}${toggle("bgMute", "대기 중에는 음소거")}${toggle("dnd", "방해 금지 (알림 없이 모아 두기)")}${toggle("duck", "메인 소리가 날 때 대기 소리 더 낮추기")}${toggle("screen", "화면 변화도 감지 (이미지가 서버로 전송됨)")}</div>`;
  html += `<label class="stack"><span>감지 민감도</span><select data-setting-select="sensitivity">${[["low", "낮음 (큰 순간만)"], ["normal", "보통"], ["high", "높음"]].map(([value, text]) => `<option value="${value}" ${settings.sensitivity === value ? "selected" : ""}>${text}</option>`).join("")}</select></label>`;
  html += `<label class="stack"><span>메인 음량 <output id="setting-focusVol">${settings.focusVol}%</output></span><input type="range" min="0" max="100" value="${settings.focusVol}" data-setting-range="focusVol" aria-label="메인 음량"></label>`;
  html += `<label class="stack"><span>대기 음량 <output id="setting-bgVol">${settings.bgVol}%</output></span><input type="range" min="0" max="100" value="${settings.bgVol}" data-setting-range="bgVol" aria-label="대기 음량"></label>`;
  html += `<label class="stack"><span>판단 서버 주소</span><input type="url" value="${escapeHTML(settings.serverUrl)}" data-setting-text="serverUrl"></label>`;
  html += `<label class="stack"><span>데모 토큰</span><input type="password" value="${escapeHTML(settings.token)}" data-setting-text="token"></label>`;
  return html + `<div class="notice">단축키: Alt+Shift+K 탭 연결, Alt+Shift+→ 다른 소리에 집중, Alt+Shift+← 복귀. 변경은 chrome://extensions/shortcuts 에서 합니다.</div>`;
}

function renderMoment(moment) {
  const slot = state.slots.findIndex((item) => item.tabId === moment.tabId);
  return `<article class="slot"><div class="row"><h3>${moment.keyword ? `"${escapeHTML(moment.keyword)}"` : moment.confident ? "중요한 순간" : "큰 순간일 수 있음"}</h3><span class="sub">${escapeHTML(moment.topic)} · ${moment.time}</span></div><p>${escapeHTML(moment.summary)}</p>${moment.evidence.length ? `<div class="source"><span class="sub">${moment.evidence.map(escapeHTML).join("<br>")}</span></div>` : ""}<div class="two">${button("잠깐 듣기", `peek:${slot}`, "", slot < 0)}${button("지우기", `dismiss:${moment.id}`)}</div></article>`;
}

function renderMoments() {
  let html = `<h3>놓친 순간</h3>`;
  if (state.returnSummary) html += renderReturn();
  html += state.moments.length ? state.moments.map(renderMoment).join("") : `<div class="notice">아직 감지한 순간이 없어요. 대기 중인 탭을 대신 듣고 있으면 여기에 쌓입니다.</div>`;
  if (state.transcript.length) {
    html += `<h3>최근 자막</h3><div class="source"><span class="sub">${state.transcript.slice(-8).map((line) => `${line.time} ${escapeHTML(line.text)}`).join("<br>")}</span></div>`;
  }
  return html;
}

function render() {
  if (!state) return;
  const tabs = [["sound", "소리"], ["entrust", "맡기기"], ["moments", `순간 ${state.moments.length || ""}`]];
  let html = `<div class="segments" role="tablist">${tabs.map(([id, text]) => button(text, `tab:${id}`, "", false, `aria-pressed="${tab === id}"`)).join("")}</div>`;
  html += picker !== null ? renderPicker() : { sound: renderSound, entrust: renderEntrust, moments: renderMoments }[tab]();
  const message = notice || state.status;
  main.innerHTML = html + `<p id="notice" class="status" role="status" aria-live="polite">${escapeHTML(message)}</p>`;
}

async function dispatch(action) {
  const [name, arg, extra] = action.split(":");
  const i = Number(arg);
  notice = "";
  switch (name) {
    case "tab":
      tab = arg;
      picker = null;
      return render();
    case "pick":
      picker = i;
      pending = selections[i]?.id ?? null;
      return render();
    case "back":
      picker = null;
      return render();
    case "select":
      pending = Number(arg);
      return render();
    case "confirm": {
      const source = (state.available ?? state.audible).find(item => item.id === pending);
      if (!source || state.slots[1-picker].tabId === source.id || selections[1-picker]?.id === source.id) return;
      selections[picker] = source;
      await transport.saveSelections(selections);
      picker = null;
      return render();
    }
    case "clear":
      selections[i] = null;
      await transport.saveSelections(selections);
      return render();
    case "connect":
      if (!selections[i] || connecting.has(i)) return;
      connecting.add(i);
      render();
      try { return await act("connect", { index: i, tabId: selections[i].id }); }
      finally { connecting.delete(i); render(); }
    case "stop":
      return act("disconnect", { index: i });
    case "focus":
    case "peek":
    case "mute":
    case "pin":
      return act(name, { index: i });
    case "pip":
      return act("pip", { index: i });
    case "pan":
      return act("pan", { index: i, value: Number(extra) });
    case "goto":
      return act("goto", { tabId: i });
    case "dismiss":
      return act("dismiss", { id: action.slice("dismiss:".length) });
    case "draft": {
      const request = document.getElementById("request").value.trim();
      if (!request) return;
      busy = true;
      render();
      const reply = await act("create-profile", { request });
      busy = false;
      draft = reply?.ok ? reply.result : null;
      return render();
    }
    case "save-draft":
      await act("save-profile", { profile: draft });
      draft = null;
      return render();
    case "drop-draft":
      draft = null;
      return render();
    default:
      return act(name);
  }
}

root.addEventListener("click", (event) => {
  const target = event.target.closest("[data-action]");
  if (target && !target.disabled) dispatch(target.dataset.action).catch(error => {
    notice = error.message;
    render();
  });
});
root.addEventListener("input", (event) => {
  const { dataset, value } = event.target;
  if (dataset.settingRange) {
    document.getElementById(`setting-${dataset.settingRange}`).textContent = `${value}%`;
  }
  if (dataset.volume !== undefined) {
    const i = Number(dataset.volume);
    document.getElementById(`volume-${i}`).textContent = `${value}%`;
    act("volume", { index: i, value: Number(value) });
  }
});
root.addEventListener("change", (event) => {
  const { dataset, value, checked } = event.target;
  if (dataset.setting) act("settings", { patch: { [dataset.setting]: checked } });
  if (dataset.settingSelect) act("settings", { patch: { [dataset.settingSelect]: value } });
  if (dataset.settingRange) act("settings", { patch: { [dataset.settingRange]: Number(value) } });
  if (dataset.settingText) act("settings", { patch: { [dataset.settingText]: value.trim() } });
  if (dataset.profile !== undefined) act("set-profile", { index: Number(dataset.profile), profileId: value });
  if (dataset.topic !== undefined) act("set-topic", { host: dataset.topic, topic: value || null });
});
transport.subscribe((nextState) => {
  state = nextState;
  state.slots.forEach((slot, i) => {
    if (slot.tabId !== null) selections[i] = { id: slot.tabId, title: slot.title, host: slot.host };
  });
  const editing = ["INPUT", "SELECT"].includes(document.activeElement?.tagName);
  if (!editing) render();
});
act("state");
