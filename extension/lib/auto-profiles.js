// Shared by the extension and the audio preview. Tab text is data, never instructions.
export function cleanAlertProfile(value) {
  const text = (value, max) => typeof value === "string" ? value.trim().slice(0, max) : "";
  const rules = (Array.isArray(value?.rules) ? value.rules : []).slice(0, 6).map(rule => ({
    text: text(rule.text, 240), enabled: rule.enabled !== false,
  })).filter(rule => rule.text);
  if (!rules.length) throw new Error("알림 조건을 하나 이상 입력해 주세요.");
  const watchPhrases = (Array.isArray(value.watchPhrases) ? value.watchPhrases : []).map(phrase => text(phrase, 20)).filter(Boolean).slice(0, 12);
  return { name: text(value.name, 60) || "이 탭의 알림", summaryFocus: text(value.summaryFocus, 300), rules, watchPhrases };
}

export function alertProfileFor(slot) {
  const profile = slot.alertSetup?.profile;
  if (!profile) return null;
  const rules = profile.rules.filter(rule => rule.enabled);
  if (!rules.length) return null;
  // A scope the user chose or edited must stay exact.
  const broad = !slot.alertSetup.edited && !slot.alertSetup.request;
  return { ...profile, id: `auto-${slot.tabId}`, keywords: [], aliases: {}, requireEvidence: true,
    watchPhrases: [...(profile.watchPhrases ?? []), ...(broad ? BROAD_PHRASES : [])],
    condition: [...rules.map(rule => rule.text), ...(broad ? [BROAD_RULE] : [])].join("\n또는: "),
    summaryFocus: profile.summaryFocus || "알림 조건과 관련된 사건, 결정, 일정",
  };
}

export function contextProfile(profile, contextOnly) {
  return { ...(profile ?? { id: "context", name: "내용 파악", keywords: [], aliases: {} }), contextOnly };
}

// A genre-independent safety net: speakers announce what matters in similar words everywhere.
const BROAD_RULE = "화자가 결정, 공개, 발표, 마감, 시험, 과제, 특정인 호명처럼 듣는 사람이 놓치면 안 될 일이 곧 벌어진다고 직접 알릴 때";
const BROAD_PHRASES = ["잠시 후", "이제 곧", "곧 시작", "드디어", "처음으로", "공개", "속보", "발표", "결정", "시험에", "과제", "마감", "선착순", "잘 들으세요", "말씀드릴게", "답변해"];

// Later refinements catch up with what the tab actually became after the title.
const REFINE_AFTER_MS = [30000, 150000, 400000];

export function createAutoProfiles({ api, slots, transcript, publish, apply, readContext }) {
  async function generate(index, { refine = false, request } = {}) {
    const slot = slots()[index];
    if (!slot || slot.tabId === null) throw new Error("연결된 탭이 없습니다.");
    const previous = slot.alertSetup;
    if (request !== undefined && typeof request !== "string") throw new Error("원하는 알림을 글로 입력해 주세요.");
    const userRequest = (request ?? previous?.request ?? "").trim().slice(0, 1000);
    const setup = slot.alertSetup = {
      ...previous, status: "generating", phase: readContext ? "scanning" : "generating", error: "", edited: false,
      startedAt: previous?.startedAt ?? Date.now(), refined: refine || previous?.refined || false,
      refinements: (previous?.refinements ?? 0) + (refine ? 1 : 0),
      request: userRequest,
    };
    slot.profileId = "auto";
    const current = () => slots().includes(slot) && slot.alertSetup === setup && slot.profileId === "auto";
    await publish();
    try {
      let page = {};
      setup.scanError = "";
      if (readContext) {
        try { page = await readContext(slot.tabId); }
        catch { setup.scanError = "페이지 접근이 제한되어 제목과 인식된 자막으로 제안합니다."; }
        if (!current()) return;
        setup.phase = "generating";
        await publish();
      }
      const result = await api.suggestProfile({ ...page, title: page.title || slot.title, host: slot.host,
        ...(userRequest ? { request: userRequest } : {}),
        text: transcript(slot.tabId).slice(-6000) });
      if (!current()) return;
      setup.profile = cleanAlertProfile(result);
      setup.status = "ready";
      setup.source = refine ? "transcript" : Object.keys(page).length ? "page" : "title";
    } catch (error) {
      if (!current()) return;
      if (refine && setup.profile) { setup.status = "ready"; return; } // 기존 조건은 계속 쓸 수 있다.
      setup.status = "error";
      setup.error = error.message || "알림 조건을 만들지 못했습니다.";
    }
    if (current()) await apply();
  }

  function observe(index) {
    const slot = slots()[index], setup = slot?.alertSetup;
    if (slot?.profileId !== "auto" || !setup || setup.edited || setup.status !== "ready") return;
    const wait = REFINE_AFTER_MS[setup.refinements ?? 0];
    if (wait === undefined || Date.now() - setup.startedAt < wait || transcript(slot.tabId).length < 120) return;
    return generate(index, { refine: true });
  }

  function save(index, value) {
    const slot = slots()[index];
    if (!slot || slot.tabId === null) throw new Error("연결된 탭이 없습니다.");
    slot.alertSetup = { ...slot.alertSetup, profile: cleanAlertProfile(value), status: "ready", error: "", edited: true };
    slot.profileId = "auto";
  }
  return { generate, observe, save };
}
