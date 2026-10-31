import { directKeywords, keywordExamples } from "../lib/auto-profiles.js";
import { numberConditions } from "../lib/presets.js";
import { createTransport } from "../lib/transport.js";
const transport = await createTransport();
if (transport.isExtension) document.documentElement.classList.add("extension-popup");
let selections = await transport.getSelections();
let picker = null;
const root = document.getElementById("ab-mock");
const main = document.getElementById("ab-content");
let state = null;
let tab = "sound";
let notice = "";
let draft = null;
let busy = false;
let alertEditor = null;
let settingsTab = "general";
let presetPage = "list";
let selectedPreset = null;
let presetRequest = "";
let generation = 0;
let confirmDelete = false;
const connecting = new Set();
let addingSlot = false;
let renderedPage = null;
const sourceUsedElsewhere = (id, index) => state.slots.some((slot, i) => i !== index && slot.tabId === id) || selections.some((source, i) => i !== index && source?.id === id);

const escapeHTML = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const label = (i) => `${i + 1}번`;
const ROLE = { main: "집중", standby: "대기" };

function button(text, action, cls = "", disabled = false, extra = "") {
  return `<button type="button" class="${cls}" data-action="${action}" ${disabled ? "disabled" : ""} ${extra}>${text}</button>`;
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

function renderEmptySlot(i) {
  const source = selections[i];
  if (!source) return `<p class="sub">이 자리에 들을 소리를 넣어주세요.</p>${button("＋ 연결할 탭 고르기", `pick:${i}`, "full")}`;
  const current = !transport.isExtension || source.id === state.view.tabId;
  return `<div class="source"><strong>${escapeHTML(source.title)}</strong><span class="sub">${escapeHTML(source.host)}</span></div><div class="two">${button("다른 탭 선택", `pick:${i}`)}${button(current ? "연결하기" : "선택한 탭으로 이동 ↗", current ? `connect:${i}` : `goto:${source.id}`, "solid", connecting.has(i))}</div>${button("선택 지우기", `clear:${i}`, "quiet")}${!current ? '<p class="sub">선택한 탭으로 이동한 뒤 확장 아이콘을 다시 눌러 연결하세요.</p>' : ''}`;
}

function renderPicker() {
  const i = picker;
  const sources = state.available ?? state.audible;
  let html = button("← 슬롯으로 돌아가기", "back", "quiet") + `<div class="row"><h3>연결할 탭 선택</h3></div><p class="sub">탭을 누르면 바로 슬롯에 선택됩니다.</p><div class="picker">`;
  for (const source of sources) {
    const used = sourceUsedElsewhere(source.id, i);
    html += button(`<span>${escapeHTML(source.title)}<span class="sub">${escapeHTML(source.host)}${source.audible ? " · 재생 중" : ""}</span></span>${used ? '<span class="sub">다른 슬롯에서 사용 중</span>' : ""}`, `select:${source.id}`, "choice", used);
  }
  if (!sources.length) html += '<p class="sub">연결할 웹 탭이 없습니다. 먼저 동영상이나 음악 탭을 열어주세요.</p>';
  return html + `</div>`;
}

function renderSlot(slot, i) {
  const connected = slot.tabId !== null;
  const main = slot.role === "main";
  const focused = (state.peek ?? state.manual) === i;
  const selected = Boolean(selections[i]);
  const status = connected && main ? "집중 탭" : connected || selected ? "대기 탭" : "비어 있음";
  const kind = connected && main ? "focused" : connected || selected ? "standby" : "vacant";
  const symbol = kind === "standby" ? `<img src="${transport.isExtension ? "../icons/pause.svg" : "/extension/icons/pause.svg"}" width="18" height="18" alt="">` : `<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><circle cx="9" cy="9" r="5" fill="${kind === "focused" ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.5"/></svg>`;
  let html = `<article class="slot ${connected ? "" : "empty"} ${main ? "focus-card" : ""}" aria-label="${label(i)} 탭 소리"><div class="slot-heading"><h3 class="tab-status ${kind}"><span class="status-icon" aria-hidden="true">${symbol}</span>${status}</h3>${button(`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg>`, `remove-slot:${i}`, "quiet remove-slot", connecting.size > 0, `aria-label="${label(i)} 탭 삭제" title="탭 삭제"`)}</div>`;
  if (!connected) return html + renderEmptySlot(i) + "</article>";
  const volume = slot.volumes[slot.role ?? "main"];
  html += `<div class="source"><strong>${escapeHTML(slot.title)}</strong><span class="sub">${escapeHTML(slot.host)} · 주제 ${escapeHTML(slot.topic ?? "미분류")}</span></div>`;
  html += `<label class="stack slot-preset"><span class="sub">알림 프리셋</span><select data-profile="${i}" aria-label="${label(i)} 탭 알림 프리셋"><option value="" ${!slot.profileId ? "selected" : ""}>알림 사용 안 함</option><option value="auto" ${slot.profileId === "auto" ? "selected" : ""}>AI 자동 설정</option>${state.profiles.filter(profile => profile.id.startsWith("custom-")).map(profile => `<option value="${escapeHTML(profile.id)}" ${slot.profileId === profile.id ? "selected" : ""}>${escapeHTML(profile.name)}</option>`).join("")}</select></label>`;
  html += renderAlertSummary(slot, i);
  html += `<label><span class="row"><span>${ROLE[slot.role] ?? ""} 음량</span><output id="volume-${i}">${volume}%${slot.muted ? " · 음소거" : ""}</output></span><input type="range" min="0" max="100" step="1" value="${volume}" data-volume="${i}" aria-label="소리 ${label(i)} 음량"></label>`;
  html += `<div class="segments" role="group" aria-label="소리 ${label(i)} 출력 방향">${[-1, 0, 1].map((p, k) => button(["왼쪽", "양쪽", "오른쪽"][k], `pan:${i}:${p}`, "", false, `aria-pressed="${slot.pan === p}"`)).join("")}</div>`;
  html += button(focused ? "집중 중" : "여기에 집중", `focus:${i}`, focused ? "solid full" : "full", focused);
  html += `<div class="slot-actions">${button("탭으로 이동 ↗", `goto:${slot.tabId}`, "quiet")}${button("소형 플레이어", `pip:${i}`, "quiet")}${button("연결 해제", `stop:${i}`, "quiet")}</div>`;
  return html + "</article>";
}

function renderSound() {
  let html = "";

  html += `<div class="settings-top sound-top"><span aria-hidden="true"></span><h3>사운드홈</h3></div>`;
  if (state.peek !== null) {
    html += `<div class="notice"><h3>${label(state.peek)}를 잠깐 확인 중</h3><div class="two">${button("확인 끝 · 복귀", "restore", "solid")}${button("계속 집중", "keep")}</div></div>`;
  }
  html += state.slots.map(renderSlot).join("");
  html += button(addingSlot ? "추가 중…" : "＋ 탭 추가", "add-slot", "full add-slot", addingSlot);
  return html;
}

function renderAlertSummary(slot, i) {
  const setup = slot.alertSetup;
  if (slot.profileId !== "auto") return "";
  const status = setup?.status === "generating" ? setup.phase === "scanning" ? "연결된 탭의 설명과 본문을 읽는 중…" : "AI가 이 탭의 알림 조건을 만드는 중…"
    : setup?.status === "error" ? `조건 생성 실패: ${setup.error}`
    : setup?.profile ? setup.profile.name : "이 탭의 알림을 준비하고 있어요.";
  const source = setup?.edited ? "직접 수정한 조건을 유지합니다." : setup?.scanError || (setup?.source === "transcript" ? "최근 자막을 참고해 보완했어요." : setup?.source === "page" ? "탭의 설명·본문·표시된 자막을 참고했어요. 재생 자막이 모이면 한 번 보완합니다." : "탭 제목으로 제안하고, 자막이 모이면 한 번 보완합니다.");
  return `<div class="notice alert-summary"><p role="status">${escapeHTML(status)}</p><p class="sub">${escapeHTML(source)}</p>${setup?.request ? `<p class="sub">내 요청: ${escapeHTML(setup.request).slice(0, 160)}</p>` : ""}${button("알림 조건 확인·수정", `edit-alert:${i}`, "quiet alert-edit-link")}</div>`;
}

function presetFields(profile, target) {
  const condition = target === "alert" ? numberConditions(profile.rules.filter(rule => rule.enabled).map(rule => rule.text).join("\n")) : profile.condition;
  return `<label class="stack"><span>프리셋 이름</span><input type="text" maxlength="60" data-${target}-field="name" value="${escapeHTML(profile.name)}"></label><label class="stack"><span>AI가 판단할 알림 조건</span><textarea rows="5" maxlength="2000" data-${target}-field="condition">${escapeHTML(condition)}</textarea></label><label class="stack"><span>키워드 설정</span><input type="text" data-${target}-field="keywords" value="${escapeHTML(directKeywords(profile).join(", "))}" placeholder="${escapeHTML(keywordExamples(profile, condition).length ? `예: ${keywordExamples(profile, condition).join(", ")}` : "키워드를 입력하세요")}"><span class="sub">키워드는 직접 입력하고 쉼표 로 구분하세요. 자주 나오는 단어는 알림이 많아질 수 있어요.</span></label>`;
}

function presetKeywordDetail(profile) {
  return `<section class="settings-section"><h3>키워드 설정</h3><div class="preset-description">${escapeHTML((profile.keywords ?? []).join(", ") || "없음")}</div></section>`;
}

function renderAlertEditor() {
  const { index, tabId, profile } = alertEditor;
  const slot = state.slots[index];
  if (slot?.tabId !== tabId) return `<div class="notice">연결된 탭이 바뀌었습니다.</div>${button("돌아가기", "close-alert")}`;
  let html = backNavigation("close-alert", "사운드홈으로 돌아가기") + `<div class="preset-heading"><h3>알림 조건을 다듬어주세요</h3></div>`;
  if (slot.alertSetup?.status === "generating") html += `<div class="notice" role="status">AI가 조건을 제안하고 있어요. 기다리는 동안 직접 작성해도 됩니다.</div>`;
  if (slot.alertSetup?.status === "error") html += `<div class="notice" role="alert">${escapeHTML(slot.alertSetup.error)} 직접 작성하거나 다시 시도해 주세요.</div>`;
  html += presetFields(profile, "alert");
  html += `<div class="preset-actions">${button("저장하고 적용", "save-alert", "solid full")}${button("프리셋으로 저장", "preset-from-alert", "full")}${button("취소", "close-alert", "quiet")}</div>`;
  html += `<details class="settings-advanced" data-profile-detail="ai-regenerate"><summary>AI로 다시 만들기</summary><div class="stack"><label class="stack">AI에게 원하는 알림 설명하기<textarea rows="4" maxlength="1000" data-alert-request aria-label="AI에게 원하는 알림 설명하기" placeholder="원하는 알림 상황을 적어주세요.">${escapeHTML(alertEditor.request)}</textarea></label>${button(slot.alertSetup?.status === "generating" ? "AI 생성 중…" : "요청 반영해 다시 만들기", "prompt-alert", "solid full", slot.alertSetup?.status === "generating")}</div></details>`;
  return html;
}

function settingsSwitch(name, title, description = "") {
  return `<label class="setting-row"><span><span class="setting-title">${title}</span>${description ? `<span class="sub">${description}</span>` : ""}</span><input class="setting-switch" type="checkbox" role="switch" data-setting="${name}" ${state.settings[name] ? "checked" : ""}></label>`;
}
function volumeSetting(name, title) {
  return `<label class="setting-volume"><span class="row"><span>${title}</span><output id="setting-${name}">${state.settings[name]}%</output></span><input type="range" min="0" max="100" value="${state.settings[name]}" data-setting-range="${name}" aria-label="${title}"></label>`;
}
function renderGeneral() {
  return `<section class="settings-section sound-settings"><h3>음량</h3><div class="settings-card">${settingsSwitch("auto", "보는 탭에 따라 집중 전환 제안", "대기 탭을 3초 이상 보면 물어봐요. 확인해야 음량이 바뀝니다.")}${volumeSetting("focusVol", "집중 음량")}${volumeSetting("bgVol", "대기 음량")}</div></section>
    <section class="settings-section"><h3>알림</h3><div class="settings-card">${settingsSwitch("dnd", "방해 금지", "알림을 띄우지 않고 모아둬요.")}</div></section>
    <section class="settings-section shortcut-help" aria-label="단축키"><h3>단축키</h3><div class="settings-card">${[["연결", "K"], ["집중 전환", "→"], ["복귀", "←"]].map(([name, key]) => `<div class="shortcut-row"><span>${name}</span><span class="shortcut-keys"><kbd>Ctrl</kbd><span class="shortcut-plus">+</span><kbd>Shift</kbd><span class="shortcut-plus">+</span><kbd>${key}</kbd></span></div>`).join("")}</div></section>`;
}
function renderPresetList() {
  const custom = state.profiles.filter(profile => profile.id.startsWith("custom-"));
  const builtIn = state.profiles.filter(profile => !profile.id.startsWith("custom-"));
  const items = profiles => profiles.map(profile => button(`<span class="preset-copy"><strong>${escapeHTML(profile.name)}</strong><span class="sub">${escapeHTML(profile.previewText || profile.condition || "알림 조건 확인하기")}</span></span><span aria-hidden="true">›</span>`, `preset-view:${state.profiles.indexOf(profile)}`, "preset-item")).join("");
  return `<section class="settings-section"><div class="preset-section-heading"><h3>내 프리셋 <span class="count">${custom.length}</span></h3>${button("＋ 만들기", "preset-new", "preset-add")}</div>${custom.length ? `<div class="preset-list">${items(custom)}</div>` : `<div class="preset-empty"><p>나만의 알림을 만들어보세요</p><p class="sub">원하는 순간을 적으면 AI가 초안을 만들어요.</p>${button("첫 프리셋 만들기", "preset-new", "quiet first-preset-link")}</div>`}</section><section class="settings-section"><h3>추천 프리셋</h3><div class="preset-list">${items(builtIn)}</div></section>`;
}
function backNavigation(action, label, title = "") {
  return `<div class="settings-top">${button("←", action, "quiet back-link", false, `aria-label="${escapeHTML(label)}"`)}${title ? `<h3>${escapeHTML(title)}</h3>` : ""}</div>`;
}
function presetBack() {
  return backNavigation("preset-back", "프리셋 목록으로 돌아가기");
}
function renderPresetDetail() {
  const profile = state.profiles.find(item => item.id === selectedPreset);
  if (!profile) return `${presetBack()}<p>이 프리셋을 찾을 수 없어요.</p>`;
  const custom = profile.id.startsWith("custom-");
  return `${presetBack()}<div class="preset-heading">${custom ? "" : '<span class="sub">추천 프리셋</span>'}<h3>${escapeHTML(profile.name)}</h3></div><section class="settings-section"><h3>이럴 때 알려줘요</h3><div class="preset-description">${escapeHTML(profile.condition)}</div></section>${presetKeywordDetail(profile)}<div class="preset-actions">${button(custom ? "수정하기" : "복사해서 수정", "preset-edit", "full")}${custom ? button("삭제", "preset-delete", "quiet danger") : ""}</div>${confirmDelete ? `<dialog class="delete-dialog" aria-labelledby="delete-title" aria-describedby="delete-description"><h3 id="delete-title">이 프리셋을 삭제할까요?</h3><p id="delete-description">적용 중인 탭의 알림도 해제돼요.</p>${notice ? `<p role="alert">${escapeHTML(notice)}</p>` : ""}<div class="two">${button("취소", "preset-delete-cancel", "", busy, "autofocus")}${button(busy ? "삭제 중…" : "삭제하기", "preset-delete-confirm", "danger", busy)}</div></dialog>` : ""}`;
}
function renderPresetCreate() {
  let html = `${presetBack()}<div class="preset-heading">${draft ? '<span class="sub">내용 확인</span>' : ""}<h3>${draft ? "알림 조건을 다듬어주세요" : "어떤 순간을 알려드릴까요?"}</h3></div>`;
  if (!draft) return html + `<label class="stack"><span class="sub">원하는 상황을 자유롭게 적어주세요.</span><textarea rows="5" maxlength="200" data-preset-request placeholder="한화 경기에서 한타나 갱킹이 시작하면 알려줘">${escapeHTML(presetRequest)}</textarea></label><p class="sub">예: 강의에서 과제나 시험 일정이 나오면 알려줘</p>${button(busy ? "초안을 만들고 있어요…" : "AI로 초안 만들기", "draft", "solid full", busy)}${button("직접 작성하기", "preset-manual", "quiet", busy)}`;
  html += presetFields(draft, "preset") + `<div class="preset-actions">${button(busy ? "저장 중…" : "프리셋 저장", "save-draft", "solid full", busy)}${button("취소", "preset-back", "quiet", busy)}</div>`;
  return html;
}
function renderEntrust() {
  if (presetPage === "detail" && settingsTab === "presets") return renderPresetDetail();
  if (presetPage === "create" && settingsTab === "presets") return renderPresetCreate();
  return `${backNavigation("tab:sound", "사운드홈으로 돌아가기", "세부설정")}<nav class="settings-tabs" aria-label="세부설정 분류">${button("기본 설정", "settings-tab:general", "", false, `aria-pressed="${settingsTab === "general"}"`)}${button("프리셋", "settings-tab:presets", "", false, `aria-pressed="${settingsTab === "presets"}"`)}</nav><div class="settings-content">${settingsTab === "general" ? renderGeneral() : renderPresetList()}</div>`;
}

function render() {
  if (!state) return;
  const toggle = document.getElementById("settings-toggle");
  if (toggle) { toggle.textContent = "세부설정"; toggle.hidden = tab === "entrust"; }
  const openProfiles = new Set([...main.querySelectorAll("details[open][data-profile-detail]")].map(item => item.dataset.profileDetail));
  let html = alertEditor ? renderAlertEditor() : picker !== null ? renderPicker() : tab === "entrust" ? renderEntrust() : renderSound();
  const message = notice || (tab === "entrust" ? "" : state.status);
  const page = alertEditor ? "alert" : picker !== null ? `picker:${picker}` : tab === "entrust" ? `${tab}:${settingsTab}:${presetPage}` : tab;
  const scrollTop = page === renderedPage ? main.scrollTop : 0;
  main.innerHTML = html + `<p id="notice" class="${tab === "entrust" ? "sub" : "status"}" role="status" aria-live="polite">${escapeHTML(message)}</p>`;
  main.scrollTop = scrollTop;
  renderedPage = page;
  main.querySelectorAll("details[data-profile-detail]").forEach(item => { item.open = openProfiles.has(item.dataset.profileDetail); });
  const dialog = main.querySelector(".delete-dialog");
  if (dialog) {
    dialog.addEventListener("cancel", event => {
      event.preventDefault();
      if (!busy) { confirmDelete = false; render(); }
    });
    dialog.showModal();
  }

}

async function dispatch(action) {
  const [name, arg, extra] = action.split(":");
  const i = Number(arg);
  notice = "";
  switch (name) {
    case "toggle-settings":
      return dispatch(tab === "entrust" ? "tab:sound" : "tab:entrust");
    case "tab":
      generation++; busy = false;
      alertEditor = null;
      tab = arg;
      picker = null;
      return render();
    case "add-slot": {
      if (addingSlot) return;
      addingSlot = true; render();
      const reply = await act("add-slot");
      addingSlot = false;
      if (reply?.ok) picker = null;
      return render();
    }
    case "remove-slot": {
      if (connecting.size) return;
      const previous = selections.slice();
      selections.splice(i, 1);
      const reply = await act("remove-slot", { index: i });
      if (!reply?.ok) selections = previous;
      else await transport.saveSelections(selections);
      return render();
    }
    case "pick":
      picker = i;
      return render();
    case "back":
      picker = null;
      return render();
    case "edit-alert": {
      const slot = state.slots[i];
      alertEditor = { index: i, tabId: slot.tabId, dirty: false, request: slot.alertSetup?.request ?? "", profile: structuredClone(slot.alertSetup?.profile ?? {
        name: "이 탭의 알림", summaryFocus: "", rules: [{ text: "", enabled: true }],
      }) };
      return render();
    }
    case "close-alert": alertEditor = null; return render();
    case "add-rule":
      if (alertEditor.profile.rules.length < 6) alertEditor.profile.rules.push({ text: "", enabled: true });
      alertEditor.dirty = true; return render();
    case "remove-rule": alertEditor.profile.rules.splice(i, 1); alertEditor.dirty = true; return render();
    case "save-alert": {
      const reply = await act("save-alerts", { index: alertEditor.index, tabId: alertEditor.tabId, profile: alertEditor.profile });
      if (reply?.ok) { alertEditor = null; notice = "알림 조건을 저장했어요."; render(); }
      return;
    }
    case "prompt-alert": {
      const { index, tabId } = alertEditor;
      const request = alertEditor.request.trim();
      if (!request) { notice = "어떤 상황에서 알림을 받고 싶은지 입력해 주세요."; return render(); }
      const reply = await act("generate-alerts", { index, tabId, request });
      if (reply?.ok) { alertEditor = null; notice = "요청을 반영해 알림 조건을 만들고 있어요."; render(); }
      return;
    }
    case "select": {
      if (picker === null) return;
      const source = (state.available ?? state.audible).find(item => item.id === i);
      if (!source || sourceUsedElsewhere(source.id, picker)) return;
      const next = [...selections];
      next[picker] = source;
      await transport.saveSelections(next);
      selections = next;
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
      try { return await act("connect", { index: i, tabId: selections[i].id, reopenPopup: transport.isExtension }); }
      finally { connecting.delete(i); render(); }
    case "stop":
      return act("disconnect", { index: i });
    case "focus":
      return act(name, { index: i });
    case "pip":
      return act("pip", { index: i });
    case "pan":
      return act("pan", { index: i, value: Number(extra) });
    case "goto":
      return act("goto", { tabId: i });
    case "settings-tab": settingsTab = arg; presetPage = "list"; return render();
    case "preset-back":
      generation++; busy = false; draft = null; confirmDelete = false; presetPage = "list"; return render();
    case "preset-from-alert": {
      const profile = alertEditor.profile;
      draft = { id: `custom-${crypto.randomUUID()}`, name: profile.name, condition: numberConditions(profile.rules.filter(rule => rule.enabled).map(rule => rule.text).join("\n")), summaryFocus: "", keywords: directKeywords(profile), keywordExamples: profile.keywordExamples ?? [], aliases: {} };
      alertEditor = null; tab = "entrust"; settingsTab = "presets"; presetPage = "create";
      return render();
    }
    case "preset-new":
      presetPage = "create"; draft = null; presetRequest = ""; return render();
    case "preset-manual":
      draft = { id: `custom-${crypto.randomUUID()}`, name: "", condition: "", keywords: [], summaryFocus: "", aliases: {} }; return render();
    case "preset-view": selectedPreset = state.profiles[i]?.id; presetPage = "detail"; confirmDelete = false; return render();
    case "preset-edit": {
      const profile = state.profiles.find(item => item.id === selectedPreset);
      if (!profile) return;
      draft = structuredClone(profile);
      if (!profile.id.startsWith("custom-")) { draft.id = `custom-${crypto.randomUUID()}`; draft.name += " 복사본"; }
      presetPage = "create"; return render();
    }
    case "preset-delete": confirmDelete = true; return render();
    case "preset-delete-cancel":
      if (busy) return;
      confirmDelete = false; render();
      main.querySelector('[data-action="preset-delete"]')?.focus();
      return;
    case "preset-delete-confirm": {
      if (busy) return;
      busy = true; render();
      const reply = await act("delete-profile", { id: selectedPreset });
      busy = false;
      if (reply?.ok) { presetPage = "list"; confirmDelete = false; notice = "프리셋을 삭제했어요."; }
      return render();
    }
    case "draft": {
      if (busy) return;
      const request = presetRequest.trim();
      if (!request) { notice = "알림을 받고 싶은 상황을 적어주세요."; return render(); }
      busy = true;
      const attempt = ++generation;
      render();
      let reply;
      try { reply = await send("create-profile", { request }); }
      catch (error) { reply = { ok: false, error: error.message }; }
      if (attempt !== generation) return;
      busy = false;
      if (reply?.ok) draft = reply.result;
      else notice = reply?.error || "초안을 만들지 못했어요. 다시 시도하거나 직접 작성해 주세요.";
      return render();
    }
    case "save-draft": {
      if (busy || !draft) return;
      if (!draft.name.trim() || !draft.condition.trim()) { notice = "프리셋 이름과 알림 조건을 입력해 주세요."; return render(); }
      busy = true;
      const profile = structuredClone(draft);
      render();
      const reply = await act("save-profile", { profile });
      busy = false;
      if (reply?.ok) { selectedPreset = null; draft = null; presetPage = "list"; notice = ""; }
      return render();
    }
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
  if (dataset.presetRequest !== undefined) presetRequest = value;
  if (draft && dataset.presetField) draft[dataset.presetField] = dataset.presetField === "keywords" ? value.split(",").map(word => word.trim()).filter(Boolean) : value;
  if (alertEditor && dataset.alertRequest !== undefined) { alertEditor.request = value; alertEditor.dirty = true; }
  if (alertEditor && (dataset.alertField || dataset.alertRule !== undefined || dataset.alertEnabled !== undefined)) {
    alertEditor.dirty = true;
    if (dataset.alertField === "keywords") { alertEditor.profile.keywords = value.split(",").map(word => word.trim()).filter(Boolean); alertEditor.profile.keywordMode = "direct"; alertEditor.profile.watchPhrases = []; }
    else if (dataset.alertField === "condition") alertEditor.profile.rules = [{ text: value, enabled: true }];
    else if (dataset.alertField) alertEditor.profile[dataset.alertField] = value;
    if (dataset.alertRule !== undefined) alertEditor.profile.rules[Number(dataset.alertRule)].text = value;
    if (dataset.alertEnabled !== undefined) alertEditor.profile.rules[Number(dataset.alertEnabled)].enabled = event.target.checked;
  }
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
  if (dataset.profile !== undefined) act("set-profile", { index: Number(dataset.profile), profileId: value });
  if (dataset.topic !== undefined) act("set-topic", { host: dataset.topic, topic: value || null });
});
transport.subscribe((nextState) => {
  const alertContentChanged = state && nextState.slots.some((slot, i) =>
    slot.profileId !== state.slots[i]?.profileId ||
    JSON.stringify(slot.alertSetup) !== JSON.stringify(state.slots[i]?.alertSetup));
  state = nextState;
  selections = Array.from({ length: state.slots.length }, (_, i) => selections[i] ?? null);
  const availableIds = new Set(state.available?.map(source => source.id));
  let removedSelection = false;
  selections = selections.map(source => {
    if (source && state.available && !availableIds.has(source.id)) {
      removedSelection = true;
      return null;
    }
    return source;
  });
  if (removedSelection) void transport.saveSelections(selections);
  const closedEditor = alertEditor && state.slots[alertEditor.index]?.tabId !== alertEditor.tabId;
  if (closedEditor) alertEditor = null;
  if (alertEditor && !alertEditor.dirty) {
    const slot = state.slots[alertEditor.index];
    if (slot.tabId === alertEditor.tabId && slot.alertSetup?.profile) alertEditor.profile = structuredClone(slot.alertSetup.profile);
  }
  state.slots.forEach((slot, i) => {
    if (slot.tabId !== null) selections[i] = { id: slot.tabId, title: slot.title, host: slot.host };
  });
  const editing = ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName);
  if ((!editing || removedSelection || closedEditor || (alertContentChanged && !alertEditor && tab === "sound" && picker === null)) && !confirmDelete) {
    const focusedProfile = document.activeElement?.dataset?.profile;
    render();
    if (focusedProfile !== undefined) main.querySelector(`[data-profile="${Number(focusedProfile)}"]`)?.focus();
  }
});
act("state");
