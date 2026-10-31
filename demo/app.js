"use strict";
// UI-only prototype. Replace SOURCES and dispatch actions with extension messaging later.
const SOURCES = [
  { id: "lecture", title: "디자인 강의", site: "YouTube · 재생 중" },
  { id: "live", title: "라이브 방송", site: "YouTube · 재생 중" },
  { id: "meeting", title: "프로젝트 회의", site: "Google Meet · 참여 중" },
  {
    id: "music",
    title: "작업할 때 듣는 음악",
    site: "YouTube Music · 재생 중",
  },
];
const root = document.getElementById("ab-mock");
const main = document.getElementById("ab-content");
const initialSlot = (i) => ({
  source: null,
  connected: false,
  pan: 0,
  volume: i === 0 ? 80 : 15,
  muted: false,
});
let state = {
  slots: [initialSlot(0), initialSlot(1)],
  picker: null,
  pending: null,
  focused: null,
  snapshot: null,
  temporary: false,
  notice: "",
};
let returnFocus = null;
const escapeHTML = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const label = (i) => ["A", "B"][i];
const getSource = (id) => SOURCES.find((x) => x.id === id);
function button(text, action, cls = "", disabled = false, extra = "") {
  return `<button type="button" class="${cls}" data-action="${action}" ${disabled ? "disabled" : ""} ${extra}>${text}</button>`;
}
function snapshot() {
  return { slots: structuredClone(state.slots), focused: state.focused };
}
function restore() {
  if (!state.snapshot) return;
  const previous = state.snapshot;
  state.slots = state.slots.map((slot, i) => {
    const old = previous.slots[i];
    return slot.connected && old.connected && slot.source === old.source
      ? { ...slot, volume: old.volume, pan: old.pan, muted: old.muted }
      : slot;
  });
  state.focused =
    previous.focused !== null && state.slots[previous.focused].connected
      ? previous.focused
      : null;
  state.snapshot = null;
  state.temporary = false;
}
function focusSlot(i, temporary = false) {
  if (!state.slots[i].connected || state.focused === i) return;
  state.snapshot = snapshot();
  state.focused = i;
  state.temporary = temporary;
  state.slots.forEach((slot, j) => {
    if (slot.connected) {
      slot.volume = j === i ? 80 : 15;
      slot.muted = false;
    }
  });
  state.notice = temporary
    ? `${label(i)}를 잠깐 확인 중이에요.`
    : `${label(i)} 소리에 집중합니다.`;
}
function renderSlot(slot, i) {
  const source = getSource(slot.source);
  const active = slot.connected && state.focused === i;
  let html = `<article class="slot ${!source ? "empty" : ""} ${active ? "focus-card" : ""}" aria-label="소리 ${label(i)}"><div class="row"><div class="row"><span class="letter">${label(i)}</span><h3>소리 ${label(i)}</h3></div><span class="badge ${active ? "focus-badge" : ""}">${slot.connected ? (active ? "집중 중" : "배경") : source ? "선택됨 · 연결 전" : "비어 있음"}</span></div>`;
  if (!source)
    return (
      html +
      `<p class="sub">이 자리에 들을 소리를 넣어주세요.</p>${button("＋ 연결할 탭 고르기", `pick:${i}`, "full")}</article>`
    );
  html += `<div class="source"><strong>${escapeHTML(source.title)}</strong><span class="sub">${escapeHTML(source.site)}</span></div>`;
  if (!slot.connected) {
    html += `<div class="two">${button("다른 탭 선택", `pick:${i}`)}${button(`${label(i)} 연결하기`, `connect:${i}`, "solid")}</div>${button("선택 지우기", `clear:${i}`, "quiet")}`;
  } else {
    html += `<label><span class="row"><span>볼륨</span><output id="volume-${i}">${slot.volume}%${slot.muted ? " · 음소거" : ""}</output></span><input type="range" min="0" max="100" step="1" value="${slot.volume}" data-volume="${i}" aria-label="소리 ${label(i)} 볼륨"></label>`;
    html += `<div class="segments" role="group" aria-label="소리 ${label(i)} 출력 방향">${[-1, 0, 1].map((p, k) => button(["왼쪽", "양쪽", "오른쪽"][k], `pan:${i}:${p}`, "", false, `aria-pressed="${slot.pan === p}"`)).join("")}</div>`;
    html += `<div class="two">${button(active ? "집중 중" : "여기에 집중", `focus:${i}`, active ? "solid" : "", active)}${button(slot.muted ? "소리 켜기" : "듣기 음소거", `mute:${i}`, "", false, `aria-pressed="${slot.muted}"`)}</div>`;
    if (!active && !state.temporary)
      html += button("잠깐 확인", `peek:${i}`, "full");
    html += `<div class="row">${button("탭으로 이동 ↗", `goto:${i}`, "quiet")}${button("연결 해제", `stop:${i}`, "quiet")}</div>`;
  }
  return html + "</article>";
}
function render() {
  let html = "";
  if (state.picker !== null) {
    const i = state.picker;
    html =
      button("← 슬롯으로 돌아가기", "back", "quiet") +
      `<div class="row"><h3>${label(i)}에 연결할 소리 선택</h3><span class="letter">${label(i)}</span></div><p class="sub">탭을 선택한 뒤 아래 버튼으로 확정하세요.</p><div class="picker">`;
    for (const source of SOURCES) {
      const used = state.slots[1 - i].source === source.id;
      html += button(
        `<span>${escapeHTML(source.title)}<span class="sub">${escapeHTML(source.site)}</span></span><span class="sub">${used ? "다른 슬롯에서 사용 중" : state.pending === source.id ? "선택됨" : "선택"}</span>`,
        `select:${source.id}`,
        "choice",
        used,
        `aria-pressed="${state.pending === source.id}"`,
      );
    }
    html += `</div>${button(`${label(i)} 슬롯에 선택하기`, "confirm", "solid full", !state.pending)}<div class="notice">데모용 탭 목록입니다. 선택만으로 소리가 연결되지는 않아요.</div>`;
  } else {
    html = `<div class="row"><h3>내 소리 구성</h3><span class="sub">${state.slots.filter((x) => x.connected).length} / 2 연결됨</span></div>`;
    if (state.temporary)
      html += `<div class="notice"><h3>${label(state.focused)}를 잠깐 확인 중</h3><p>돌아갈 소리: ${state.snapshot?.focused !== null ? label(state.snapshot.focused) : "이전 설정"}</p><div class="two">${button("확인 끝 · 복귀", "restore", "solid")}${button("계속 집중", "keep")}</div></div>`;
    html += state.slots.map(renderSlot).join("");
    if (state.slots.some((x) => x.connected))
      html += `<div class="footer-actions">${button("다른 소리에 집중", "switch", "full", state.slots.filter((x) => x.connected).length < 2)}${button("이전 상태로 복귀", "restore", "full", !state.snapshot)}</div>`;
    html += `<div class="notice">${state.slots.some((x) => x.connected) ? "연결한 소리만 조절됩니다. 연결 해제 시 실제 제품에서는 원래 탭 출력으로 돌아갑니다." : "소리를 먼저 골라도 재생에는 영향이 없어요. 각 슬롯의 연결 버튼을 눌러 시작하세요."}</div>`;
  }
  main.innerHTML =
    html +
    `<p id="notice" class="status" role="status" aria-live="polite">${escapeHTML(state.notice)}</p>`;
}
function dispatch(action) {
  const [name, arg, extra] = action.split(":");
  const i = Number(arg);
  state.notice = "";
  switch (name) {
    case "pick":
      state.picker = i;
      state.pending = state.slots[i].source;
      returnFocus = `pick:${i}`;
      break;
    case "back":
      state.picker = null;
      state.pending = null;
      break;
    case "select":
      state.pending = arg;
      break;
    case "confirm":
      if (state.pending) {
        state.slots[state.picker].source = state.pending;
        state.picker = null;
        state.pending = null;
      }
      break;
    case "clear":
      state.slots[i] = initialSlot(i);
      break;
    case "connect":
      if (!state.slots[i].source) return;
      if (state.snapshot) restore();
      state.slots[i].connected = true;
      if (state.focused === null) {
        state.focused = i;
        state.slots[i].volume = 80;
      } else state.slots[i].volume = 15;
      state.notice = `${label(i)} 슬롯이 연결된 상태로 변경됐어요. (데모)`;
      break;
    case "stop":
      if (state.temporary) restore();
      state.slots[i].connected = false;
      state.slots[i].muted = false;
      if (state.focused === i) state.focused = null;
      state.snapshot = null;
      state.temporary = false;
      state.notice = "탭 선택은 유지하고 연결만 해제했어요.";
      break;
    case "focus":
      focusSlot(i);
      break;
    case "peek":
      focusSlot(i, true);
      break;
    case "switch":
      focusSlot(state.focused === 0 ? 1 : 0);
      break;
    case "restore":
      restore();
      state.notice = "이전 음량·방향·음소거 상태로 돌아왔어요.";
      break;
    case "keep":
      state.temporary = false;
      state.notice = "현재 소리에 계속 집중합니다.";
      break;
    case "mute":
      state.slots[i].muted = !state.slots[i].muted;
      break;
    case "pan":
      state.slots[i].pan = Number(extra);
      break;
    case "goto":
      state.notice = `실제 확장에서는 ${getSource(state.slots[i].source).title} 탭으로 이동해요.`;
      break;
  }
  render();
}
root.addEventListener("click", (event) => {
  const target = event.target.closest("[data-action]");
  if (!target || target.disabled) return;
  const action = target.dataset.action;
  dispatch(action);
  // Keep keyboard navigation usable when the view is redrawn.
  const same = Array.from(main.querySelectorAll("[data-action]")).find(
    (x) => x.dataset.action === action && !x.disabled,
  );
  const fallback =
    action === "back"
      ? Array.from(main.querySelectorAll("[data-action]")).find(
          (x) => x.dataset.action === returnFocus,
        )
      : null;
  (same || fallback || main.querySelector("button:not(:disabled)"))?.focus({
    preventScroll: true,
  });
});
root.addEventListener("input", (event) => {
  const slider = event.target;
  if (slider.dataset.volume === undefined) return;
  const i = Number(slider.dataset.volume);
  state.slots[i].volume = Number(slider.value);
  document.getElementById(`volume-${i}`).textContent =
    slider.value + "%" + (state.slots[i].muted ? " · 음소거" : "");
});
render();
