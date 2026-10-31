// Persistent page alerts. New events replace the old card; summary updates never reopen one.
if (!globalThis.audioFocusLoaded) {
  globalThis.audioFocusLoaded = true;
  let currentMomentId = null;
  let summaryNode = null;
  let evidenceNode = null;
  let statusNode = null;
  let fullSummaryNode = null;
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
    .compact { box-sizing: border-box; width: min(360px, calc(100vw - 24px)); padding: 10px 14px; display: block; }
    .compact .head { align-items: center; gap: 6px; margin-bottom: 3px; }
    .brand { display: inline-flex; align-items: center; gap: 5px; color: #242432; font-size: 13px; font-weight: 650; letter-spacing: -.3px; }
    .brand img { width: 24px; height: 24px; object-fit: contain; }
    .time { margin-left: auto; font-size: 11px; }
    .compact .close { border: 0; width: 28px; min-height: 28px; padding: 0; margin-right: -5px; font-size: 20px; line-height: 1; color: #737385; }
    .source { color: #6254d8; font-size: 11px; margin-bottom: 3px; }
    .compact h1 { font-size: 15px; line-height: 1.35; overflow-wrap: anywhere; }
    .preview { margin-top: 3px; color: #737385; line-height: 1.45; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
    .compact details { margin-top: 5px; }
    .compact summary { padding: 2px 0; font-size: 11px; color: #737385; cursor: pointer; }
    .detail-body { display: grid; gap: 6px; margin-top: 6px; }
    .compact blockquote { overflow-wrap: anywhere; }
    .compact .row { grid-template-columns: 1fr auto; margin-top: 8px; }
    .compact .row button { min-height: 30px; padding: 5px 12px; border: 0; border-radius: 7px; background: #eeebff; color: #6254d8; }
    .compact .row .solid { background: #6254d8; color: #fff; }
    .error:not(:empty) { margin-top: 6px; }
    @media (pointer: coarse) { .compact .close, .compact .row button, .compact summary { min-height: 44px; } .compact .close { width: 44px; } }
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
    fullSummaryNode.textContent = moment.summary;
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
      card.className = "card compact";
      const head = document.createElement("div");
      head.className = "head";
      const brand = text("span", ""); brand.className = "brand";
      const logo = document.createElement("img");
      logo.src = chrome.runtime.getURL("icons/brand.png");
      logo.alt = "";
      brand.append(logo, text("span", "CatchSound"));
      const time = text("span", moment.time); time.className = "time";
      const dismiss = action("×", close); dismiss.className = "close";
      dismiss.setAttribute("aria-label", "알림 닫기");
      head.append(brand, time, dismiss);
      const source = text("p", moment.topic); source.className = "source";
      statusNode = text("p", ""); statusNode.className = "status";
      summaryNode = text("p", ""); evidenceNode = text("blockquote", "");
      summaryNode.className = "preview";
      fullSummaryNode = text("p", "");
      const details = document.createElement("details");
      const detailBody = document.createElement("div"); detailBody.className = "detail-body";
      detailBody.append(statusNode, fullSummaryNode, evidenceNode);
      details.append(text("summary", "감지한 내용 보기"), detailBody);
      const errorNode = text("p", ""); errorNode.className = "status error";
      errorNode.setAttribute("role", "alert");
      const row = document.createElement("div"); row.className = "row";
      const focus = action("이 탭에 집중", async () => {
        focus.disabled = true;
        try {
          const reply = await chrome.runtime.sendMessage({ to: "bg", cmd: "focus", tabId: moment.tabId });
          if (!reply?.ok) throw new Error(reply?.error || "탭을 전환하지 못했습니다.");
          close();
        } catch (error) { errorNode.textContent = error.message; focus.disabled = false; }
      }, true);
      row.append(focus, action("나중에", close));
      card.append(head, source, text("h1", moment.keyword ? `"${moment.keyword}" 감지` : "중요한 순간일 수 있어요"), summaryNode, details, row, errorNode);
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
