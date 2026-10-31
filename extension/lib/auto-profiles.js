// Shared by the extension and the audio preview. Tab text is data, never instructions.
export function cleanAlertProfile(value) {
  const text = (value, max) => typeof value === "string" ? value.trim().slice(0, max) : "";
  const rules = (Array.isArray(value?.rules) ? value.rules : []).slice(0, 6).map(rule => ({
    text: text(rule.text, 240), enabled: rule.enabled !== false,
  })).filter(rule => rule.text);
  if (!rules.length) throw new Error("알림 조건을 하나 이상 입력해 주세요.");
  return { name: text(value.name, 60) || "이 탭의 알림", summaryFocus: text(value.summaryFocus, 300), rules };
}

export function alertProfileFor(slot) {
  const profile = slot.alertSetup?.profile;
  if (!profile) return null;
  const rules = profile.rules.filter(rule => rule.enabled);
  if (!rules.length) return null;
  return { ...profile, id: `auto-${slot.tabId}`, keywords: [], aliases: {}, requireEvidence: true,
    condition: rules.map(rule => rule.text).join("\n또는: "),
    summaryFocus: profile.summaryFocus || "알림 조건과 관련된 사건, 결정, 일정",
  };
}

export function contextProfile(profile, contextOnly) {
  return { ...(profile ?? { id: "context", name: "내용 파악", keywords: [], aliases: {} }), contextOnly };
}

export function createAutoProfiles({ api, slots, transcript, publish, apply }) {
  async function generate(index, { refine = false } = {}) {
    const slot = slots()[index];
    if (!slot || slot.tabId === null) throw new Error("연결된 탭이 없습니다.");
    const previous = slot.alertSetup;
    const setup = slot.alertSetup = {
      ...previous, status: "generating", error: "", edited: false,
      startedAt: previous?.startedAt ?? Date.now(), refined: refine || previous?.refined || false,
    };
    slot.profileId = "auto";
    const current = () => slots()[index] === slot && slot.alertSetup === setup && slot.profileId === "auto";
    await publish();
    try {
      const result = await api.suggestProfile({ title: slot.title, host: slot.host,
        text: refine ? transcript(slot.tabId).slice(-6000) : "" });
      if (!current()) return;
      setup.profile = cleanAlertProfile(result);
      setup.status = "ready";
      setup.source = refine ? "transcript" : "title";
    } catch (error) {
      if (!current()) return;
      setup.status = "error";
      setup.error = error.message || "알림 조건을 만들지 못했습니다.";
    }
    if (current()) await apply();
  }

  function observe(index) {
    const slot = slots()[index], setup = slot?.alertSetup;
    if (slot?.profileId !== "auto" || !setup || setup.edited || setup.refined || setup.status !== "ready") return;
    if (Date.now() - setup.startedAt < 30000 || transcript(slot.tabId).length < 120) return;
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
