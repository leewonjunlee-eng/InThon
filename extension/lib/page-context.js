// This function is injected into the connected tab. Keep it self-contained.
export function collectPageContext() {
  const trim = (value, limit) => String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
  const visibleText = selector => trim(document.querySelector(selector)?.innerText, 3500);
  const meta = selector => trim(document.querySelector(selector)?.getAttribute("content"), 1500);
  const youtube = /(^|\.)youtube\.com$/.test(location.hostname);
  const title = youtube ? visibleText("ytd-watch-metadata h1") || document.title : document.title;
  const description = (youtube ? visibleText("ytd-watch-metadata #description") : "")
    || meta('meta[name="description"]') || meta('meta[property="og:description"]');
  const headings = [...document.querySelectorAll(youtube ? "ytd-watch-metadata h1" : "h1, h2")]
    .slice(0, 8).map(node => trim(node.innerText, 120)).filter(Boolean).join(" / ");
  const captions = youtube ? [...document.querySelectorAll(".ytp-caption-segment")]
    .map(node => node.innerText).join(" ") : "";
  let pageText = "";
  if (!youtube) {
    const area = document.querySelector("article") || document.querySelector("main") || document.body;
    if (area) {
      const walker = document.createTreeWalker(area, NodeFilter.SHOW_TEXT);
      let node, visited = 0;
      while ((node = walker.nextNode()) && visited++ < 1000 && pageText.length < 3500) {
        const parent = node.parentElement;
        if (!parent || parent.closest('nav, aside, footer, header, script, style, noscript, form, input, textarea, select, [contenteditable], [hidden], [aria-hidden="true"], [role="navigation"], [role="dialog"]')) continue;
        const style = getComputedStyle(parent);
        if (style.display === "none" || style.visibility === "hidden" || !parent.getClientRects().length) continue;
        const value = trim(node.textContent, 600);
        if (value) pageText += `${value}\n`;
      }
    }
  }
  return { title: trim(title, 300), description: trim(description, 1500),
    headings: trim(headings, 600), pageText: trim(pageText, 3500), captions: trim(captions, 1000) };
}

export async function scanConnectedTab(tabId) {
  const [frame] = await chrome.scripting.executeScript({ target: { tabId }, func: collectPageContext });
  if (!frame?.result || typeof frame.result !== "object") throw new Error("탭 내용을 읽지 못했습니다.");
  return frame.result;
}
