import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, emptySlot } from "../extension/lib/logic.js";

test("the real popup editor keeps unsaved edits during updates and submits enabled conditions", async () => {
  const handlers = new Map(), sent = [];
  const main = { innerHTML: "", querySelectorAll: () => [] };
  const root = { addEventListener: (event, handler) => handlers.set(event, handler) };
  const slot = { ...emptySlot(), tabId: 11, title: "제품 공개", host: "example.com", role: "standby", profileId: "auto",
    alertSetup: { status: "ready", source: "title", profile: { name: "판매 알림", summaryFocus: "가격", rules: [{ text: "가격이 공개되면", enabled: true }] } } };
  const state = { slots: [slot, emptySlot()], profiles: [], settings: DEFAULT_SETTINGS, status: "", available: [], manual: null, peek: null };
  let subscriber;
  const documentBefore = globalThis.document, chromeBefore = globalThis.chrome;
  globalThis.document = { documentElement: { classList: { add() {} } }, activeElement: null,
    getElementById: id => id === "ab-mock" ? root : main };
  globalThis.chrome = { runtime: { id: "test", onMessage: { addListener: handler => { subscriber = handler; } },
    sendMessage: async message => { sent.push(message); if (message.cmd === "state") subscriber({ to: "ui", state }); return { ok: true }; } },
    storage: { session: { get: async () => ({}), set: async () => {} } } };
  const click = async action => {
    handlers.get("click")({ target: { closest: () => ({ dataset: { action }, disabled: false }) } });
    await new Promise(resolve => setImmediate(resolve));
  };
  try {
    await import("../extension/popup/app.js");
    await new Promise(resolve => setImmediate(resolve));
    assert(main.innerHTML.includes("알림 조건 확인·수정"));
    await click("edit-alert:0");
    assert(main.innerHTML.includes("가격이 공개되면"));
    handlers.get("input")({ target: { dataset: { alertRule: "0" }, value: "판매가 시작되면" } });
    handlers.get("input")({ target: { dataset: { alertEnabled: "0" }, value: "on", checked: false } });
    subscriber({ to: "ui", state: structuredClone(state) });
    assert(main.innerHTML.includes("판매가 시작되면"), "incoming state cannot erase unsaved changes");
    await click("save-alert");
    const save = sent.find(message => message.cmd === "save-alerts");
    assert.equal(save.tabId, 11);
    assert.deepEqual(save.profile.rules, [{ text: "판매가 시작되면", enabled: false }]);
    assert(main.innerHTML.includes("알림 조건을 저장했어요."));
    await click("edit-alert:0");
    assert(main.innerHTML.includes("AI에게 원하는 알림 설명하기"));
    await click("prompt-alert");
    assert(main.innerHTML.includes("어떤 상황에서 알림을 받고 싶은지 입력"));
    assert(!sent.some(message => message.cmd === "generate-alerts"));
    const request = "한화가 경기할 때 갱과 한타만 알려줘. 일정은 빼줘.";
    handlers.get("input")({ target: { dataset: { alertRequest: "" }, value: request } });
    subscriber({ to: "ui", state: structuredClone(state) });
    assert(main.innerHTML.includes(request));
    await click("prompt-alert");
    const generate = sent.find(message => message.cmd === "generate-alerts");
    assert.equal(generate.tabId, 11);
    assert.equal(generate.request, request);
  } finally {
    globalThis.document = documentBefore;
    globalThis.chrome = chromeBefore;
  }
});
