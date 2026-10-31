import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, emptySlot } from "../extension/lib/logic.js";

test("the real popup editor keeps unsaved edits during updates and submits enabled conditions", async () => {
  const handlers = new Map(), sent = [], savedSelections = [];
  const main = { innerHTML: "", querySelectorAll: () => [] };
  const root = { addEventListener: (event, handler) => handlers.set(event, handler) };
  const slot = { ...emptySlot(), tabId: 11, title: "제품 공개", host: "example.com", role: "standby", profileId: "auto",
    alertSetup: { status: "ready", source: "title", profile: { name: "판매 알림", summaryFocus: "가격", rules: [{ text: "가격이 공개되면", enabled: true }] } } };
  const state = { slots: [slot, emptySlot()], profiles: [{ id: "lol", name: "롤" }, { id: "custom-game", name: "내 경기" }], settings: DEFAULT_SETTINGS, view: { tabId: 11 }, status: "", available: [{ id: 11, title: "제품 공개" }, { id: 12, title: "다른 탭" }], manual: null, peek: null };
  let subscriber;
  const documentBefore = globalThis.document, chromeBefore = globalThis.chrome;
  globalThis.document = { documentElement: { classList: { add() {} } }, activeElement: null,
    getElementById: id => id === "ab-mock" ? root : main };
  globalThis.chrome = { runtime: { id: "test", onMessage: { addListener: handler => { subscriber = handler; } },
    sendMessage: async message => { sent.push(message); if (message.cmd === "state") subscriber({ to: "ui", state }); return { ok: true }; } },
    storage: { session: { get: async () => ({ uiSelections: [null, { id: 12, title: "다른 탭" }] }), set: async value => { savedSelections.push(structuredClone(value.uiSelections)); } } } };
  const click = async action => {
    handlers.get("click")({ target: { closest: () => ({ dataset: { action }, disabled: false }) } });
    await new Promise(resolve => setImmediate(resolve));
  };
  try {
    await import("../extension/popup/app.js");
    await new Promise(resolve => setImmediate(resolve));
    assert(main.innerHTML.includes('aria-label="1번 탭 알림 프리셋"'));
    assert(main.innerHTML.includes('value="custom-game"'));
    handlers.get('change')({ target: { dataset: { profile: '0' }, value: 'custom-game' } });
    await new Promise(resolve => setImmediate(resolve));
    assert(sent.some(message => message.cmd === 'set-profile' && message.index === 0 && message.profileId === 'custom-game'));
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
    await click('tab:entrust');
    assert(main.innerHTML.includes('기본 설정'));
    assert(main.innerHTML.includes('감지 · 알림'));
    assert(main.innerHTML.includes('aria-label="소리 구성으로 돌아가기"'));
    assert(!main.innerHTML.includes('대기 소리 음소거'));
    assert(!main.innerHTML.includes('메인 소리가 나면 대기 소리 줄이기'));
    assert(!main.innerHTML.includes('AI 서버 연결'));
    await click('settings-tab:presets');
    assert(main.innerHTML.includes('내 프리셋'));
    await click('preset-new');
    assert(main.innerHTML.includes('AI로 초안 만들기'));
    await click('draft');
    assert(main.innerHTML.includes('알림을 받고 싶은 상황을 적어주세요'));
    await click('preset-manual');
    handlers.get('input')({ target: { dataset: { presetField: 'name' }, value: '내 경기 알림' } });
    handlers.get('input')({ target: { dataset: { presetField: 'condition' }, value: '한타가 시작되면' } });
    subscriber({ to: 'ui', state: structuredClone(state) });
    assert(main.innerHTML.includes('한타가 시작되면'), 'state updates preserve preset draft');
    await click('save-draft');
    const savedPreset = sent.find(message => message.cmd === 'save-profile');
    assert.equal(savedPreset.profile.name, '내 경기 알림');
    assert.equal(savedPreset.profile.condition, '한타가 시작되면');
    assert(savedPreset.profile.id.startsWith('custom-'));
    await click('tab:sound');
    await click('edit-alert:0');
    globalThis.document.activeElement = { tagName: 'TEXTAREA' };
    subscriber({ to: 'ui', state: { ...state, slots: [emptySlot(), emptySlot()], available: [{ id: 12, title: '다른 탭' }] } });
    assert(!main.innerHTML.includes('AI에게 원하는 알림 설명하기'), 'closed tab dismisses its editor even while typing');
    assert(!main.innerHTML.includes('제품 공개'), 'closed tab does not reappear as a selected source');
    assert(main.innerHTML.includes('다른 탭'), 'remaining selection stays visible');
    assert.deepEqual(savedSelections.at(-1), [null, { id: 12, title: '다른 탭' }]);
    subscriber({ to: 'ui', state: { ...state, slots: [emptySlot(), emptySlot()], available: [] } });
    assert.deepEqual(savedSelections.at(-1), [null, null]);
    assert(!main.innerHTML.includes('선택한 탭으로 이동'), 'closing a selected tab clears its stale reconnect button');
  } finally {
    globalThis.document = documentBefore;
    globalThis.chrome = chromeBefore;
  }
});
