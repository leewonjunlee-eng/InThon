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
let serverDraft = null;
let serverTesting = false;
const connecting = new Set();

const escapeHTML = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const label = (i) => `${i + 1}번`;
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
    const used = state.slots[1-i].tabId === source.id || selections[1-i]?.id === source.id;
    html += button(`<span>${escapeHTML(source.title)}<span class="sub">${escapeHTML(source.host)}${source.audible ? " · 재생 중" : ""}</span></span>${used ? '<span class="sub">다른 슬롯에서 사용 중</span>' : ""}`, `select:${source.id}`, "choice", used);
  }
  if (!sources.length) html += '<p class="sub">연결할 웹 탭이 없습니다. 먼저 동영상이나 음악 탭을 열어주세요.</p>';
  return html + `</div><div class="notice">선택만으로 소리가 연결되지는 않아요. Chrome에서는 선택한 탭에서 확장 아이콘을 눌러 연결합니다.</div>`;
}

function renderSlot(slot, i) {
  const connected = slot.tabId !== null;
  const main = slot.role === "main";
  const focused = (state.peek ?? state.manual) === i;
  const selected = Boolean(selections[i]);
  const status = connected && main ? "집중 탭" : connected || selected ? "대기 탭" : "비어 있음";
  const kind = connected && main ? "focused" : connected || selected ? "standby" : "vacant";
  const symbol = kind === "standby" ? `<img src="${transport.isExtension ? "../icons/pause.svg" : "/extension/icons/pause.svg"}" width="18" height="18" alt="">` : kind === "focused" ? "●" : "○";
  let html = `<article class="slot ${connected ? "" : "empty"} ${main ? "focus-card" : ""}" aria-label="${label(i)} 탭 소리"><div class="slot-heading"><h3 class="tab-status ${kind}"><span class="status-icon" aria-hidden="true">${symbol}</span>${status}</h3>${!connected && selected ? '<span class="sub">연결 전</span>' : ''}</div>`;
  if (!connected) return html + renderEmptySlot(i) + "</article>";
  const volume = slot.volumes[slot.role ?? "main"];
  html += `<div class="source"><strong>${escapeHTML(slot.title)}</strong><span class="sub">${escapeHTML(slot.host)} · 주제 ${escapeHTML(slot.topic ?? "미분류")}</span></div>`;
  html += renderAlertSummary(slot, i);
  html += `<label><span class="row"><span>${ROLE[slot.role] ?? ""} 볼륨</span><output id="volume-${i}">${volume}%${slot.muted ? " · 음소거" : ""}</output></span><input type="range" min="0" max="100" step="1" value="${volume}" data-volume="${i}" aria-label="소리 ${label(i)} 볼륨"></label>`;
  html += `<div class="segments" role="group" aria-label="소리 ${label(i)} 출력 방향">${[-1, 0, 1].map((p, k) => button(["왼쪽", "양쪽", "오른쪽"][k], `pan:${i}:${p}`, "", false, `aria-pressed="${slot.pan === p}"`)).join("")}</div>`;
  html += button(focused ? "집중 중" : "여기에 집중", `focus:${i}`, focused ? "solid full" : "full", focused);
  html += `<div class="row">${button("탭으로 이동 ↗", `goto:${slot.tabId}`, "quiet")}${button("소형 플레이어", `pip:${i}`, "quiet")}${button("연결 해제", `stop:${i}`, "quiet")}</div>`;
  return html + "</article>";
}

function renderSound() {
  const connected = state.slots.filter((slot) => slot.tabId !== null).length;
  let html = "";

  html += `<div class="row"><h3>내 소리 구성</h3><span class="sub">${connected} / 2 연결됨</span></div>`;
  if (state.returnSummary) html += renderReturn();
  if (state.peek !== null) {
    html += `<div class="notice"><h3>${label(state.peek)}를 잠깐 확인 중</h3><div class="two">${button("확인 끝 · 복귀", "restore", "solid")}${button("계속 집중", "keep")}</div></div>`;
  }
  html += state.slots.map(renderSlot).join("");
  return html;
}

function renderReturn() {
  const item = state.returnSummary;
  return `<div class="notice"><h3>놓친 내용 · 소리 ${label(item.slot)} (${item.minutes}분)</h3><p>${escapeHTML(item.summary)}</p>${button("확인", "clear-return", "quiet")}</div>`;
}

function renderProfileSelect(slot, i) {
  const options = state.profiles.map((item) => `<option value="${escapeHTML(item.id)}" ${slot.profileId === item.id ? "selected" : ""}>${escapeHTML(item.name)}</option>`).join("");
  return `<label class="stack"><span>소리 ${label(i)} · ${escapeHTML(slot.title).slice(0, 20)}</span><select data-profile="${i}"><option value="" ${!slot.profileId ? "selected" : ""}>대신 듣지 않음</option><option value="auto" ${slot.profileId === "auto" ? "selected" : ""}>AI가 만든 이 탭의 조건</option>${options}</select></label>${renderAlertSummary(slot, i)}`;
}

function renderAlertSummary(slot, i) {
  const setup = slot.alertSetup;
  if (slot.profileId !== "auto") return "";
  const enabled = setup?.profile?.rules.filter(rule => rule.enabled).length ?? 0;
  const status = setup?.status === "generating" ? setup.phase === "scanning" ? "연결된 탭의 설명과 본문을 읽는 중…" : "AI가 이 탭의 알림 조건을 만드는 중…"
    : setup?.status === "error" ? `조건 생성 실패: ${setup.error}`
    : setup?.profile ? `${setup.profile.name} · ${enabled ? `${enabled}개 조건 사용 중` : "알림 조건 모두 꺼짐"}` : "이 탭의 알림을 준비하고 있어요.";
  const source = setup?.edited ? "직접 수정한 조건을 유지합니다." : setup?.scanError || (setup?.source === "transcript" ? "최근 자막을 참고해 보완했어요." : setup?.source === "page" ? "탭의 설명·본문·표시된 자막을 참고했어요. 재생 자막이 모이면 한 번 보완합니다." : "탭 제목으로 제안하고, 자막이 모이면 한 번 보완합니다.");
  return `<div class="notice alert-summary"><p role="status">${escapeHTML(status)}</p><p class="sub">${escapeHTML(source)}</p>${setup?.request ? `<p class="sub">내 요청: ${escapeHTML(setup.request).slice(0, 160)}</p>` : ""}${button("알림 조건 확인·수정", `edit-alert:${i}`, "quiet")}</div>`;
}

function renderAlertEditor() {
  const { index, tabId, profile } = alertEditor;
  const slot = state.slots[index];
  if (slot.tabId !== tabId) return `<div class="notice">연결된 탭이 바뀌었습니다.</div>${button("돌아가기", "close-alert")}`;
  let html = button("← 돌아가기", "close-alert", "quiet") + `<h3>소리 ${label(index)} · 알림 조건</h3><p class="sub">${escapeHTML(slot.title)}</p><p class="sub">체크한 상황 중 하나가 실제로 발생하면 대기 중에 알려드려요. 저장한 수정 내용은 AI가 덮어쓰지 않습니다.</p>`;
  if (slot.alertSetup?.status === "generating") html += `<div class="notice" role="status">AI가 조건을 제안하고 있어요. 기다리는 동안 직접 작성해도 됩니다.</div>`;
  if (slot.alertSetup?.status === "error") html += `<div class="notice" role="alert">${escapeHTML(slot.alertSetup.error)} 직접 작성하거나 다시 시도해 주세요.</div>`;
  html += `<div class="notice stack"><label class="stack">AI에게 원하는 알림 설명하기<textarea rows="4" maxlength="1000" data-alert-request aria-label="AI에게 원하는 알림 설명하기" placeholder="한화가 경기 중일 때 한화의 갱킹, 상대가 한화 라인에 갱을 올 때, 한화가 참여하는 한타만 알려줘. 일정 안내는 빼줘.">${escapeHTML(alertEditor.request)}</textarea></label><p class="sub">누구의 어떤 상황을 알고 싶은지 적어 주세요. 요청을 우선해 조건을 새로 만들고 적용합니다.</p>${button(slot.alertSetup?.status === "generating" ? "AI 생성 중…" : "요청 반영해 다시 만들기", "prompt-alert", "solid full", slot.alertSetup?.status === "generating")}</div>`;
  html += `<label class="stack">알림 이름<input type="text" maxlength="60" data-alert-field="name" value="${escapeHTML(profile.name)}"></label>`;
  html += `<div class="alert-rules">${profile.rules.map((rule, j) => `<div class="alert-rule"><label class="check"><input type="checkbox" data-alert-enabled="${j}" ${rule.enabled ? "checked" : ""}> 조건 ${j + 1} 사용</label><textarea rows="3" maxlength="240" data-alert-rule="${j}" aria-label="알림 조건 ${j + 1}">${escapeHTML(rule.text)}</textarea>${button("삭제", `remove-rule:${j}`, "quiet")}</div>`).join("")}</div>`;
  html += button("＋ 조건 추가", "add-rule", "full", profile.rules.length >= 6);
  html += `<label class="stack">요약에서 알고 싶은 내용<textarea rows="2" maxlength="300" data-alert-field="summaryFocus">${escapeHTML(profile.summaryFocus)}</textarea></label>`;
  html += `<div class="two">${button("저장하고 적용", "save-alert", "solid")}${button("취소", "close-alert")}</div>`;
  html += button(slot.alertSetup?.status === "generating" ? "AI 생성 중…" : "AI로 다시 제안받기", "regenerate-alert", "full", slot.alertSetup?.status === "generating");
  return html;
}

function renderEntrust() {
  const connected = state.slots.map((slot, i) => (slot.tabId !== null ? renderProfileSelect(slot, i) : "")).join("");
  let html = button("← 소리로 돌아가기", "tab:sound", "quiet") + `<h3>세부 설정 (맡기기)</h3><h3>무엇을 맡길까요?</h3><p class="sub">대기 중인 탭만 대신 듣습니다. 음성은 저장하지 않고, 자막은 탭을 닫으면 지워집니다.</p>`;
  html += connected || `<div class="notice">먼저 소리 화면에서 연결해 주세요.</div>`;
  html += `<label class="stack"><span>조건을 한 줄로 적기</span><input type="text" id="request" maxlength="200" placeholder="두산 득점하면 알려줘"></label>${button(busy ? "만드는 중…" : "프로필 만들기", "draft", "full", busy)}`;
  if (draft) {
    html += `<div class="notice"><h3>${escapeHTML(draft.name)}</h3><p>조건: ${escapeHTML(draft.condition)}</p><p>단어: ${escapeHTML(draft.keywords.join(", "))}</p><p>요약 초점: ${escapeHTML(draft.summaryFocus)}</p><div class="two">${button("저장", "save-draft", "solid")}${button("취소", "drop-draft")}</div></div>`;
  }
  html += renderProfiles();
  const { settings } = state;
  const connection = serverDraft ?? settings;
  html += `<details class="profile-detail"><summary>AI 서버 연결</summary><div class="stack"><p class="sub">다른 PC에서도 레블업 AI를 사용하려면 공용 중계 서버에 연결하세요. 레블업 API 키는 서버에만 보관됩니다.</p><label class="stack">서버 주소<input type="url" data-server-field="serverUrl" value="${escapeHTML(connection.serverUrl)}" placeholder="https://your-server.vercel.app"></label><label class="stack">서버 접속 토큰<input type="password" data-server-field="token" value="${escapeHTML(connection.token)}" autocomplete="off"></label><p class="sub">접속 토큰은 중계 서버용입니다. 레블업 API 키를 입력하지 마세요.</p>${button(serverTesting ? "연결 확인 중…" : "저장하고 연결 확인", "save-server", "full", serverTesting)}${button("공용 서버 기본 연결 복원", "restore-server", "full", serverTesting)}</div></details>`;
  html += `<h3>설정</h3><div class="stack">${toggle("auto", "보는 화면에 따라 자동 전환")}${toggle("bgMute", "대기 중에는 음소거")}${toggle("dnd", "방해 금지 (알림 없이 모아 두기)")}${toggle("duck", "메인 소리가 날 때 대기 소리 더 낮추기")}${toggle("screen", "화면 변화도 감지 (이미지가 서버로 전송됨)")}</div>`;
  html += `<label class="stack"><span>감지 민감도</span><select data-setting-select="sensitivity">${[["low", "낮음 (큰 순간만)"], ["normal", "보통"], ["high", "높음"]].map(([value, text]) => `<option value="${value}" ${settings.sensitivity === value ? "selected" : ""}>${text}</option>`).join("")}</select></label>`;
  html += `<label class="stack"><span>메인 음량 <output id="setting-focusVol">${settings.focusVol}%</output></span><input type="range" min="0" max="100" value="${settings.focusVol}" data-setting-range="focusVol" aria-label="메인 음량"></label>`;
  html += `<label class="stack"><span>대기 음량 <output id="setting-bgVol">${settings.bgVol}%</output></span><input type="range" min="0" max="100" value="${settings.bgVol}" data-setting-range="bgVol" aria-label="대기 음량"></label>`;
  return html + `<div class="notice">단축키: Control+Shift+K 탭 연결, Control+Shift+→ 다른 소리에 집중, Control+Shift+← 복귀. 변경은 chrome://extensions/shortcuts 에서 합니다.</div>`;
}

function renderProfiles() {
  const list = values => values?.length ? values.map(escapeHTML).join(", ") : "없음";
  return `<section class="profile-list" aria-label="프로필 내용"><h3>프로필 내용</h3><p class="sub">이름을 누르면 감지 조건과 키워드를 확인할 수 있어요.</p>${state.profiles.map(profile => `<details class="profile-detail" data-profile-detail="${escapeHTML(profile.id)}"><summary>${escapeHTML(profile.name)}</summary><dl><dt>감지 조건</dt><dd>${escapeHTML(profile.condition)}</dd><dt>감지 키워드</dt><dd>${list(profile.keywords)}</dd><dt>요약 초점</dt><dd>${escapeHTML(profile.summaryFocus)}</dd><dt>관련 사이트</dt><dd>${list(profile.relatedSites)}</dd><dt>관련 단어</dt><dd>${list(profile.relatedWords)}</dd></dl></details>`).join("")}</section>`;
}

function render() {
  if (!state) return;
  const openProfiles = new Set([...main.querySelectorAll("details[open][data-profile-detail]")].map(item => item.dataset.profileDetail));
  let html = alertEditor ? renderAlertEditor() : picker !== null ? renderPicker() : tab === "entrust" ? renderEntrust() : renderSound();
  const message = notice || state.status;
  main.innerHTML = html + `<p id="notice" class="status" role="status" aria-live="polite">${escapeHTML(message)}</p>`;
  main.querySelectorAll("details[data-profile-detail]").forEach(item => { item.open = openProfiles.has(item.dataset.profileDetail); });
}

async function dispatch(action) {
  const [name, arg, extra] = action.split(":");
  const i = Number(arg);
  notice = "";
  switch (name) {
    case "tab":
      alertEditor = null;
      tab = arg;
      picker = null;
      return render();
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
    case "regenerate-alert": {
      const { index, tabId } = alertEditor;
      alertEditor = null;
      return act("generate-alerts", { index, tabId });
    }
    case "prompt-alert": {
      const { index, tabId } = alertEditor;
      const request = alertEditor.request.trim();
      if (!request) { notice = "어떤 상황에서 알림을 받고 싶은지 입력해 주세요."; return render(); }
      const reply = await act("generate-alerts", { index, tabId, request });
      if (reply?.ok) { alertEditor = null; notice = "요청을 반영해 알림 조건을 만들고 있어요."; render(); }
      return;
    }
    case "save-server": {
      if (serverTesting) return;
      serverTesting = true;
      render();
      try {
        const saved = await act("settings", { patch: serverDraft ?? { serverUrl: state.settings.serverUrl, token: state.settings.token } });
        if (!saved?.ok) return;
        const checked = await act("test-server");
        if (checked?.ok) { serverDraft = null; notice = "레블업 AI 서버 연결을 확인했어요."; }
      } finally { serverTesting = false; render(); }
      return;
    }
    case "restore-server": {
      if (serverTesting) return;
      serverTesting = true;
      render();
      try {
        const reply = await act("restore-server");
        if (reply?.ok) { serverDraft = null; notice = "공용 AI 서버 연결을 복원했어요."; }
      } finally { serverTesting = false; render(); }
      return;
    }
    case "select": {
      if (picker === null) return;
      const source = (state.available ?? state.audible).find(item => item.id === i);
      if (!source || state.slots[1-picker].tabId === source.id || selections[1-picker]?.id === source.id) return;
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
      try { return await act("connect", { index: i, tabId: selections[i].id }); }
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
  if (dataset.serverField) {
    serverDraft ??= { serverUrl: state.settings.serverUrl, token: state.settings.token };
    serverDraft[dataset.serverField] = value;
  }
  if (alertEditor && dataset.alertRequest !== undefined) { alertEditor.request = value; alertEditor.dirty = true; }
  if (alertEditor && (dataset.alertField || dataset.alertRule !== undefined || dataset.alertEnabled !== undefined)) {
    alertEditor.dirty = true;
    if (dataset.alertField) alertEditor.profile[dataset.alertField] = value;
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
  state = nextState;
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
  const closedEditor = alertEditor && state.slots[alertEditor.index].tabId !== alertEditor.tabId;
  if (closedEditor) alertEditor = null;
  if (alertEditor && !alertEditor.dirty) {
    const slot = state.slots[alertEditor.index];
    if (slot.tabId === alertEditor.tabId && slot.alertSetup?.profile) alertEditor.profile = structuredClone(slot.alertSetup.profile);
  }
  state.slots.forEach((slot, i) => {
    if (slot.tabId !== null) selections[i] = { id: slot.tabId, title: slot.title, host: slot.host };
  });
  const editing = ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName);
  if (!editing || removedSelection || closedEditor) render();
});
act("state");
