// 호출 알림 카드와 소형 플레이어 버튼. 페이지 스타일과 섞이지 않게 Shadow DOM에 그린다.
if (!globalThis.audioFocusLoaded) {
  globalThis.audioFocusLoaded = true;
  const CARD_MS = 8000;

  const STYLE = `
    .card { position: fixed; top: 12px; right: 12px; width: 270px; z-index: 2147483647; background: #fff; color: #242432;
      border: 1px solid #dedee8; border-radius: 12px; box-shadow: 0 12px 40px #24243233; padding: 10px;
      font: 12px/1.45 system-ui, sans-serif; display: grid; gap: 8px; }
    .head { display: flex; justify-content: space-between; color: #737385; font-size: 12px; }
    h1 { font-size: 13px; font-weight: 600; margin: 0; }
    blockquote { margin: 0; padding: 8px 10px; background: #f5f4fa; border-radius: 8px; color: #555566; font-size: 12px; }
    .row { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; }
    button { font: inherit; min-height: 30px; border: 1px solid #dedee8; border-radius: 8px; background: #fff; cursor: pointer; color: inherit; }
    .solid { background: #6254d8; border-color: #6254d8; color: #fff; }
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
    build(card, () => host.remove());
    document.documentElement.append(host);
    return host;
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

  function showMoment({ moment, slot }) {
    const send = (cmd) => chrome.runtime.sendMessage({ to: "bg", cmd, index: slot });
    mount((card, close) => {
      const head = document.createElement("div");
      head.className = "head";
      head.append(text("span", `Catch Sound · 소리 ${"AB"[slot]} ${moment.topic}`), text("span", moment.time));
      const row = document.createElement("div");
      row.className = "row";
      row.append(
        action("잠깐 듣기", () => { send("peek"); close(); }, true),
        action("여기에 집중", () => { send("focus"); close(); }),
        action("나중에", close),
      );
      card.append(head, text("h1", moment.keyword ? `"${moment.keyword}" 감지` : "중요한 순간일 수 있어요"), text("p", moment.summary));
      if (moment.evidence.length) card.append(text("blockquote", moment.evidence.at(-1)));
      card.append(row);
      setTimeout(close, CARD_MS);
    });
  }

  function showPip() {
    const video = [...document.querySelectorAll("video")].sort((a, b) => b.clientWidth - a.clientWidth)[0];
    mount((card, close) => {
      card.append(text("p", video ? "이 탭의 영상을 작은 창으로 띄웁니다." : "이 페이지에서 영상을 찾지 못했습니다."));
      if (video) {
        card.append(action("소형 플레이어 열기", async () => {
          close();
          await video.requestPictureInPicture().catch(() => {});
        }, true));
      }
      card.append(action("닫기", close));
    });
  }

  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message.to !== "content") return false;
    if (message.cmd === "moment" && message.moment) showMoment(message);
    if (message.cmd === "pip") showPip();
    respond({ ok: true });
    return false;
  });
}
