// Open alerts follow the active tab until dismissed or their original 15-second deadline.
if (!globalThis.audioFocusLoaded) {
  globalThis.audioFocusLoaded = true;
  const openCards = new Map(); // key -> { host, summaryNode, fullSummaryNode, evidenceNode, statusNode }
  const STACK_ID = "audio-focus-stack";
  const STACK_STYLE = "position: fixed; top: var(--catchsound-status-bottom, 12px); right: 12px; z-index: 2147483647; display: flex; flex-direction: column; gap: 8px; max-height: max(0px, calc(100vh - var(--catchsound-status-bottom, 12px) - 12px)); overflow: auto;";
  const STYLE = `
    .card { width: min(300px, calc(100vw - 44px)); overflow: auto; z-index: 2147483647; background: #fff; color: #242432;
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
    @media (prefers-color-scheme: dark) {
      :host { color-scheme: dark; }
      .card { background:#242426; color:#e8e7ed; border-color:#414047; box-shadow:0 12px 40px #00000040; }
      .head,.status,.preview,.compact summary,.compact .close { color:#aaa7b5; }
      .brand { color:#e8e7ed; }
      .source { color:#b6aaff; }
      blockquote { background:#2d2c32; color:#c6c3d0; }
      button { background:#2d2c32; border-color:#414047; color:#e8e7ed; }
      .compact .row button { background:#393247; color:#c2b6f2; }
      .solid,.compact .row .solid { background:#6254d8; border-color:#6254d8; color:#fff; }
      .error { color:#f098a1; }
      button:focus-visible,summary:focus-visible { outline:2px solid #b6aaff; outline-offset:2px; }
    }
    @media (pointer: coarse) { .compact .close, .compact .row button, .compact summary { min-height: 44px; } .compact .close { width: 44px; } }
  `;
  function closeCard(key) {
    const entry = openCards.get(key);
    if (!entry) return;
    clearTimeout(entry.timer);
    openCards.delete(key);
    const stack = entry.host.parent ?? entry.host.parentNode;
    entry.host.remove();
    if (!openCards.size) stack?.remove();
  }
  function mount(key, build) {
    closeCard(key);
    let stack = document.getElementById(STACK_ID);
    if (!stack) {
      stack = document.createElement("div");
      stack.id = STACK_ID;
      stack.setAttribute("style", STACK_STYLE);
      document.documentElement.append(stack);
    }
    const host = document.createElement("div");
    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = STYLE;
    const card = document.createElement("section");
    card.className = "card";
    card.setAttribute("role", "alert");
    shadow.append(style, card);
    const entry = { host };
    openCards.set(key, entry);
    build(card, () => closeCard(key), entry);
    stack.append(host);
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
    const card = openCards.get(moment.id);
    if (!card) return;
    const { summaryNode, fullSummaryNode, evidenceNode, statusNode } = card;
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
    const expiresAt = moment.expiresAt ?? Date.now() + 15000;
    if (expiresAt <= Date.now()) return;
    // Re-delivery to the same page must not reset the timer or expanded details.
    if (openCards.has(moment.id)) { updateSummary(moment); return; }
    mount(moment.id, (card, localClose, entry) => {
      const close = () => {
        localClose();
        void chrome.runtime.sendMessage({ to: "bg", cmd: "dismiss", id: moment.id }).catch(() => {});
      };
      entry.timer = setTimeout(close, Math.max(0, expiresAt - Date.now()));
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
      const statusNode = text("p", ""); statusNode.className = "status";
      const summaryNode = text("p", ""), evidenceNode = text("blockquote", "");
      summaryNode.className = "preview";
      const fullSummaryNode = text("p", "");
      Object.assign(entry, { summaryNode, fullSummaryNode, evidenceNode, statusNode });
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
  function showFocusSuggestion(message) {
    mount("focus-suggestion", (card, close, entry) => {
      entry.timer = setTimeout(close, 15000);
      card.className = "card compact";
      const head = document.createElement("div"); head.className = "head";
      const brand = text("span", ""); brand.className = "brand";
      const logo = document.createElement("img"); logo.src = chrome.runtime.getURL("icons/brand.png"); logo.alt = "";
      brand.append(logo, text("span", "CatchSound"));
      const dismiss = action("×", close); dismiss.className = "close"; dismiss.setAttribute("aria-label", "알림 닫기");
      head.append(brand, dismiss);
      const source = text("p", message.title); source.className = "source";
      const detail = text("p", "대기 탭을 보고 있어요. 집중 탭과 음량을 바꿀까요?"); detail.className = "preview";
      const errorNode = text("p", ""); errorNode.className = "status error";
      const row = document.createElement("div"); row.className = "row";
      const focus = action("이 탭에 집중", async () => {
        focus.disabled = true;
        try {
          const reply = await chrome.runtime.sendMessage({ to: "bg", cmd: "accept-focus-suggestion", tabId: message.tabId });
          if (!reply?.ok) throw new Error(reply?.error || "집중 탭을 바꾸지 못했습니다.");
          close();
        } catch (error) { errorNode.textContent = error.message; focus.disabled = false; }
      }, true);
      row.append(focus, action("유지하기", close));
      card.append(head, source, text("h1", "이 탭에 집중할까요?"), detail, row, errorNode);
    });
  }
  function showPip() {
    const video = [...document.querySelectorAll("video")].sort((a, b) => b.clientWidth - a.clientWidth)[0];
    mount("pip", (card, close) => {
      card.append(text("p", video ? "이 탭의 영상을 작은 창으로 띄웁니다." : "이 페이지에서 영상을 찾지 못했습니다."));
      if (video) card.append(action("소형 플레이어 열기", async () => {
        close(); await video.requestPictureInPicture().catch(() => {});
      }, true));
      card.append(action("닫기", close));
    });
  }

  function clearMoment(id) {
    for (const key of id ? [id] : [...openCards.keys()]) if (key !== "pip" && key !== "focus-suggestion") closeCard(key);
  }
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message.to !== "content" || message.cmd === "dnd-inbox") return false;
    if (message.cmd === "moment" && message.moment) showMoment(message);
    if (message.cmd === "moment-update" && message.moment) updateSummary(message.moment);
    if (message.cmd === "moment-clear") clearMoment(message.id);
    if (message.cmd === "focus-suggestion") showFocusSuggestion(message);
    if (message.cmd === "focus-suggestion-clear") closeCard("focus-suggestion");
    if (message.cmd === "pip") showPip();
    respond({ ok: true });
    return false;
  });
}
