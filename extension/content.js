// Persistent page alerts. New events replace the old card; summary updates never reopen one.
if (!globalThis.audioFocusLoaded) {
  globalThis.audioFocusLoaded = true;
  let currentMomentId = null;
  let summaryNode = null;
  let evidenceNode = null;
  let statusNode = null;
  const STYLE = `
    .card { position: fixed; top: 12px; right: 12px; width: min(300px, calc(100vw - 44px)); max-height: calc(100vh - 48px); overflow: auto; z-index: 2147483647; background: #fff; color: #242432;
      border: 1px solid #dedee8; border-radius: 12px; box-shadow: 0 12px 40px #24243233; padding: 12px;
      font: 12px/1.5 system-ui, sans-serif; display: grid; gap: 10px; }
    .head { display: flex; justify-content: space-between; gap: 8px; color: #737385; }
    h1 { font-size: 14px; font-weight: 600; margin: 0; }
    p { margin: 0; white-space: pre-line; overflow-wrap: anywhere; }
    .status { color: #737385; font-size: 11px; }
    blockquote { margin: 0; padding: 8px 10px; background: #f5f4fa; border-radius: 8px; color: #555566; white-space: pre-line; }
    [hidden] { display: none; }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
    button { font: inherit; min-height: 34px; border: 1px solid #dedee8; border-radius: 8px; background: #fff; cursor: pointer; color: inherit; }
    .solid { background: #6254d8; border-color: #6254d8; color: #fff; }
    button:disabled { opacity: .5; }
  `;
  function mount(build) {
    document.getElementById("audio-focus-card")?.remove();
    const host = document.createElement("div");
    host.id = "audio-focus-card";
    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = STYLE;
    const card = document.createElement("section");
    card.className = "card";
    card.setAttribute("role", "alert");
    shadow.append(style, card);
    build(card, () => {
      host.remove();
      if (!document.getElementById("audio-focus-card")) currentMomentId = null;
    });
    document.documentElement.append(host);
  }
  function text(tag, value) {
    const node = document.createElement(tag);
    node.textContent = value;
    return node;
  }
  function action(label, onClick, solid = false) {
    const node = text("button", label);
    node.type = "button";
    if (solid) node.className = "solid";
    node.onclick = onClick;
    return node;
  }
  function updateSummary(moment) {
    if (currentMomentId !== moment.id || !document.getElementById("audio-focus-card")) return;
    summaryNode.textContent = moment.summary;
    const evidence = Array.isArray(moment.evidence) ? moment.evidence : [];
    evidenceNode.textContent = evidence.join("\n");
    evidenceNode.hidden = !evidence.length || moment.summaryStatus === "loading" || moment.summaryStatus === "fallback";
    statusNode.textContent = {
      loading: "AI 요약 중 · 우선 최근 자막을 표시합니다",
      ai: "AI 요약 · 아래 자막을 근거로 작성했습니다",
      fallback: "AI 요약에 연결하지 못해 최근 자막을 표시합니다",
      "no-transcript": "인식된 자막 없음",
    }[moment.summaryStatus] ?? "감지 내용";
  }
  function showMoment({ moment }) {
    currentMomentId = moment.id;
    mount((card, close) => {
      const head = document.createElement("div");
      head.className = "head";
      head.append(text("span", `Catch Sound · ${moment.topic}`), text("span", moment.time));
      statusNode = text("p", ""); statusNode.className = "status";
      summaryNode = text("p", ""); evidenceNode = text("blockquote", "");
      const errorNode = text("p", ""); errorNode.className = "status";
      const row = document.createElement("div"); row.className = "row";
      const focus = action("여기에 집중", async () => {
        focus.disabled = true;
        try {
          const reply = await chrome.runtime.sendMessage({ to: "bg", cmd: "focus", tabId: moment.tabId });
          if (!reply?.ok) throw new Error(reply?.error || "탭을 전환하지 못했습니다.");
          close();
        } catch (error) { errorNode.textContent = error.message; focus.disabled = false; }
      }, true);
      row.append(focus, action("나중에", close));
      card.append(head, text("h1", moment.keyword ? `"${moment.keyword}" 감지` : "중요한 순간일 수 있어요"), statusNode, summaryNode, evidenceNode, row, errorNode);
    });
    updateSummary(moment);
  }
  function showPip() {
    currentMomentId = null;
    const video = [...document.querySelectorAll("video")].sort((a, b) => b.clientWidth - a.clientWidth)[0];
    mount((card, close) => {
      card.append(text("p", video ? "이 탭의 영상을 작은 창으로 띄웁니다." : "이 페이지에서 영상을 찾지 못했습니다."));
      if (video) card.append(action("소형 플레이어 열기", async () => {
        close(); await video.requestPictureInPicture().catch(() => {});
      }, true));
      card.append(action("닫기", close));
    });
  }

  function clearMoment(id) {
    if (!currentMomentId || (id && currentMomentId !== id)) return;
    document.getElementById("audio-focus-card")?.remove();
    currentMomentId = null;
  }
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message.to !== "content") return false;
    if (message.cmd === "moment" && message.moment) showMoment(message);
    if (message.cmd === "moment-update" && message.moment) updateSummary(message.moment);
    if (message.cmd === "moment-clear") clearMoment(message.id);
    if (message.cmd === "pip") showPip();
    respond({ ok: true });
    return false;
  });
}
