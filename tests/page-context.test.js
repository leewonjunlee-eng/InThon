import test from "node:test";
import assert from "node:assert/strict";
import { collectPageContext } from "../extension/lib/page-context.js";

test("YouTube scanning uses the current video description and displayed captions, not recommendations", () => {
  const originalDocument = globalThis.document, originalLocation = globalThis.location;
  const nodes = new Map([
    ["ytd-watch-metadata h1", { innerText: "제품 공개 라이브" }],
    ["ytd-watch-metadata #description", { innerText: "오후 여덟 시 판매 시작. 가격과 구성품을 소개합니다." }],
  ]);
  const selectors = [];
  globalThis.location = { hostname: "www.youtube.com" };
  globalThis.document = { title: "YouTube", querySelector: selector => { selectors.push(selector); return nodes.get(selector); },
    querySelectorAll: selector => selector === ".ytp-caption-segment" ? [{ innerText: "최종 가격을 공개합니다." }] : [nodes.get("ytd-watch-metadata h1")] };
  try {
    const result = collectPageContext();
    assert.equal(result.title, "제품 공개 라이브");
    assert.match(result.description, /구성품/);
    assert.equal(result.captions, "최종 가격을 공개합니다.");
    assert.equal(result.pageText, "");
    assert(!selectors.includes("body"));
  } finally { globalThis.document = originalDocument; globalThis.location = originalLocation; }
});

test("generic page scanning excludes forms, navigation and invisible content and bounds the text", () => {
  const globals = Object.fromEntries(["document", "location", "NodeFilter", "getComputedStyle"].map(key => [key, globalThis[key]]));
  const node = (value, excluded = false, visible = true) => ({ textContent: value,
    parentElement: { closest: () => excluded, getClientRects: () => visible ? [1] : [] } });
  const nodes = [node("입력한 개인정보", true), node("숨겨진 내용", false, false), node("반도체 신제품 발표와 사전 주문 일정"), ...Array(10).fill(node("x".repeat(800)))];
  globalThis.location = { hostname: "example.com" };
  globalThis.NodeFilter = { SHOW_TEXT: 4 };
  globalThis.getComputedStyle = () => ({ display: "block", visibility: "visible" });
  globalThis.document = { title: "발표", body: {}, querySelector: () => null, querySelectorAll: () => [],
    createTreeWalker: () => ({ nextNode: () => nodes.shift() }) };
  try {
    const result = collectPageContext();
    assert.match(result.pageText, /사전 주문/);
    assert(!result.pageText.includes("개인정보"));
    assert(!result.pageText.includes("숨겨진"));
    assert(result.pageText.length <= 3500);
  } finally { Object.assign(globalThis, globals); }
});
