import test from "node:test";
import assert from "node:assert/strict";
import { alertProfileFor, cleanAlertProfile, createAutoProfiles } from "../extension/lib/auto-profiles.js";
import { createApi } from "../extension/lib/api.js";

test("three-field presets preserve edited keywords through cleaning and listening", () => {
  const cleaned = cleanAlertProfile({ name: "경기", keywords: ["한타", "바론"], rules: [{ text: "한타가 시작되면", enabled: true }], summaryFocus: "old" });
  assert.deepEqual(cleaned.keywords, ["한타", "바론"]);
  assert.equal(cleaned.summaryFocus, "한타가 시작되면");
  const listening = alertProfileFor({ tabId: 1, alertSetup: { edited: true, profile: cleaned } });
  assert.deepEqual(listening.keywords, ["한타", "바론"]);
  assert.deepEqual(cleanAlertProfile({ ...cleaned, keywords: [] }).keywords, []);
});

const profile = (name = "판매 방송") => ({ name, summaryFocus: "가격과 판매 일정", rules: [
  { text: "최종 가격이 실제 공개되었을 때", enabled: true },
  { text: "판매 시작 시각이 확정되었을 때", enabled: false },
] });
function fixture(suggestProfile = async () => profile(), readContext) {
  const slots = [{ tabId: 10, title: "신제품 공개 라이브", host: "example.com" }];
  let context = "", applies = 0;
  const controller = createAutoProfiles({ api: { suggestProfile }, slots: () => slots,
    transcript: () => context, publish: async () => {}, apply: async () => { applies++; }, readContext,
  });
  return { slots, controller, context: value => { context = value; }, applies: () => applies };
}

test("AI conditions are generated for the connected tab and only enabled rules reach the judge", async () => {
  let request;
  const f = fixture(async value => { request = value; return profile(); });
  await f.controller.generate(0);
  assert.deepEqual(request, { title: "신제품 공개 라이브", host: "example.com", text: "" });
  assert.equal(f.slots[0].alertSetup.status, "ready");
  assert.equal(f.slots[0].profileId, "auto");
  assert.match(alertProfileFor(f.slots[0]).condition, /^최종 가격이 실제 공개되었을 때\n또는: /);
  assert(!alertProfileFor(f.slots[0]).condition.includes("판매 시작 시각"));
  assert.deepEqual(alertProfileFor(f.slots[0]).keywords, [], "words alone must not trigger generic alerts");
  f.controller.save(0, { ...profile(), rules: profile().rules.map(rule => ({ ...rule, enabled: false })) });
  assert.equal(alertProfileFor(f.slots[0]), null);
});

test("one subtitle refinement is allowed, but user edits are never overwritten", async () => {
  const requests = [];
  const f = fixture(async value => { requests.push(value); return profile(); });
  await f.controller.generate(0);
  f.slots[0].alertSetup.startedAt -= 31000;
  f.context("확정된 가격과 판매 일정에 대한 설명입니다. ".repeat(10));
  await f.controller.observe(0);
  await f.controller.observe(0);
  assert.equal(requests.length, 2);
  assert(requests[1].text.length > 120);
  assert.equal(f.slots[0].alertSetup.source, "transcript");
  f.controller.save(0, profile("내 조건"));
  f.slots[0].alertSetup.refined = false;
  await f.controller.observe(0);
  assert.equal(requests.length, 2);
});

test("refinement repeats on a schedule and a failed refinement keeps the working conditions", async () => {
  const requests = [];
  let fail = false;
  const f = fixture(async value => { if (fail) throw new Error("server"); requests.push(value); return profile(); });
  f.context("현재 진행 중인 실제 대사입니다. ".repeat(20));
  await f.controller.generate(0);
  assert(requests[0].text.length > 120, "the first generation already uses heard speech");
  for (const elapsed of [31000, 151000, 401000]) {
    f.slots[0].alertSetup.startedAt = Date.now() - elapsed;
    await f.controller.observe(0);
  }
  assert.equal(requests.length, 4);
  f.slots[0].alertSetup.startedAt = Date.now() - 900000;
  await f.controller.observe(0);
  assert.equal(requests.length, 4, "refinement stops after the last stage");
  fail = true;
  f.slots[0].alertSetup.refinements = 0;
  await f.controller.observe(0);
  assert.equal(f.slots[0].alertSetup.status, "ready");
  assert(alertProfileFor(f.slots[0]));
});

test("legacy suggested keywords become direct keywords in the listening profile", async () => {
  const f = fixture(async () => ({ ...profile(), watchPhrases: [" 바론 쪽으로 ", 7, "", "이니시"] }));
  await f.controller.generate(0);
  assert.deepEqual(alertProfileFor(f.slots[0]).keywords.slice(0, 2), ["바론 쪽으로", "이니시"]);
  assert(alertProfileFor(f.slots[0]).watchPhrases.includes("잠시 후"), "every tab gets the shared safety net");
});

test("a scope the user requested or edited is not widened by the safety net", async () => {
  const f = fixture();
  await f.controller.generate(0, { request: "가격 공개만 알려줘" });
  assert.equal(alertProfileFor(f.slots[0]).condition, "최종 가격이 실제 공개되었을 때");
  const g = fixture();
  await g.controller.generate(0);
  g.controller.save(0, profile());
  assert.equal(alertProfileFor(g.slots[0]).condition, "최종 가격이 실제 공개되었을 때");
  assert(!alertProfileFor(g.slots[0]).watchPhrases.includes("잠시 후"));
});

test("a new page regenerates conditions and restarts refinement, but keeps user conditions", async () => {
  const requests = [];
  const f = fixture(async value => { requests.push(value); return profile(); });
  await f.controller.generate(0, { request: "가격만" });
  f.slots[0].alertSetup.refinements = 3;
  f.slots[0].alertSetup.startedAt = 1;
  await f.controller.navigated(0);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].request, "가격만", "the request is about the user, not the page");
  assert.equal(f.slots[0].alertSetup.refinements, 0);
  assert(f.slots[0].alertSetup.startedAt > 1);
  f.controller.save(0, profile("내 조건"));
  await f.controller.navigated(0);
  assert.equal(requests.length, 2);
  f.slots[0].profileId = null;
  await f.controller.navigated(0);
  assert.equal(requests.length, 2);
});

test("a tab listens with the safety net while the AI is still generating", async () => {
  let resolve;
  const f = fixture(() => new Promise(done => { resolve = done; }));
  const pending = f.controller.generate(0);
  await new Promise(done => setImmediate(done));
  assert.equal(f.slots[0].alertSetup.status, "generating");
  assert.equal(f.applies(), 1, "listening starts before the answer");
  assert(alertProfileFor(f.slots[0]).condition.includes("놓치면 안 될"));
  assert(alertProfileFor(f.slots[0]).watchPhrases.includes("잠시 후"));
  resolve(profile());
  await pending;
  assert.match(alertProfileFor(f.slots[0]).condition, /^최종 가격이 실제 공개되었을 때/);
  const failed = fixture(async () => { throw new Error("slow"); });
  await failed.controller.generate(0);
  assert.equal(failed.slots[0].alertSetup.status, "error");
  assert(alertProfileFor(failed.slots[0]), "a failed generation still listens");
  const scoped = fixture(() => new Promise(() => {}));
  void scoped.controller.generate(0, { request: "가격만" });
  await new Promise(done => setImmediate(done));
  assert.equal(alertProfileFor(scoped.slots[0]), null, "a requested scope is never widened");
});

test("late generation cannot overwrite edits, a replacement connection, or a disabled profile", async () => {
  for (const change of [
    f => f.controller.save(0, profile("내 수정")),
    f => { f.slots[0] = { tabId: 20, title: "다른 탭" }; },
    f => { f.slots[0].profileId = null; },
  ]) {
    let resolve;
    const f = fixture(() => new Promise(done => { resolve = done; }));
    const generating = f.controller.generate(0);
    await Promise.resolve();
    change(f);
    resolve(profile("늦은 응답"));
    await generating;
    assert.notEqual(f.slots[0].alertSetup?.profile?.name, "늦은 응답");
  }
});

test("generation failure is visible, preserves existing rules, and supports retry", async () => {
  let fail = false;
  const f = fixture(async () => { if (fail) throw new Error("server 503"); return profile(); });
  await f.controller.generate(0);
  fail = true;
  await f.controller.generate(0);
  assert.equal(f.slots[0].alertSetup.status, "error");
  assert.equal(f.slots[0].alertSetup.error, "server 503");
  assert.equal(alertProfileFor(f.slots[0]).name, "판매 방송");
  fail = false;
  await f.controller.generate(0);
  assert.equal(f.slots[0].alertSetup.status, "ready");
});

test("empty or invalid AI conditions are rejected and input sizes are bounded", () => {
  assert.throws(() => cleanAlertProfile({ rules: [{ text: " " }] }));
  assert.equal(cleanAlertProfile({ name: "x".repeat(200), rules: Array(20).fill({ text: "x".repeat(500) }) }).rules.length, 6);
  assert.equal(cleanAlertProfile(profile()).rules[1].enabled, false);
});

test("the connected tab is scanned before generation and restricted pages fall back explicitly", async () => {
  let request, scannedId;
  const f = fixture(async value => { request = value; return profile(); }, async id => {
    scannedId = id;
    return { title: "실제 영상 제목", description: "판매 시작과 가격 공개", pageText: "본문", captions: "지금 가격을 공개합니다." };
  });
  await f.controller.generate(0);
  assert.equal(scannedId, 10);
  assert.equal(request.title, "실제 영상 제목");
  assert.equal(request.description, "판매 시작과 가격 공개");
  assert.equal(f.slots[0].alertSetup.source, "page");
  const restricted = fixture(async value => { request = value; return profile(); }, async () => { throw new Error("Cannot access page"); });
  await restricted.controller.generate(0);
  assert.equal(request.title, "신제품 공개 라이브");
  assert.equal(restricted.slots[0].alertSetup.status, "ready");
  assert.match(restricted.slots[0].alertSetup.scanError, /접근이 제한/);
});

test("disconnecting during a page scan prevents the stale page from reaching AI", async () => {
  let finishScan, calls = 0;
  const f = fixture(async () => { calls++; return profile(); }, () => new Promise(resolve => { finishScan = resolve; }));
  const pending = f.controller.generate(0);
  await Promise.resolve();
  f.slots[0] = { tabId: null };
  finishScan({ description: "이전 탭" });
  await pending;
  assert.equal(calls, 0);
});

test("user preferences override title-only generation and persist through refinement and retry", async () => {
  const requests = [];
  const f = fixture(async value => { requests.push(value); return profile("한화 경기"); });
  f.context("한화가 경기를 치르고 있습니다. ".repeat(15));
  const request = "한화 경기에서 갱킹과 한타만 알려줘. 일정은 빼줘.";
  await f.controller.generate(0, { request });
  assert.equal(requests[0].request, request);
  assert(requests[0].text.length > 120);
  assert.equal(f.slots[0].alertSetup.request, request);
  f.slots[0].alertSetup.startedAt -= 31000;
  await f.controller.observe(0);
  assert.equal(requests[1].request, request);
  await f.controller.generate(0);
  assert.equal(requests[2].request, request);
  await f.controller.generate(0, { request: "x".repeat(1200) });
  assert.equal(requests[3].request.length, 1000);
  await assert.rejects(f.controller.generate(0, { request: {} }), /글로 입력/);
});

test("an old server returns an actionable restart message rather than not found", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({ error: "not found" }) });
  try {
    const api = createApi(async () => ({ serverUrl: "http://127.0.0.1:8787", token: "" }));
    await assert.rejects(api.suggestProfile({ title: "YouTube" }), /판단 서버가 이전 버전.*python server\/server.py/);
  } finally { globalThis.fetch = originalFetch; }
});

test("a server must support prompts so user requests cannot be silently ignored", async () => {
  const originalFetch = globalThis.fetch;
  const urls = [];
  let supportsPrompts = false;
  globalThis.fetch = async (url, options) => {
    urls.push(url);
    if (url.endsWith("/health")) return { ok: true, json: async () => ({ ok: true, capabilities: supportsPrompts ? ["prompt-alerts"] : ["suggest-profile"] }) };
    assert.equal(JSON.parse(options.body).request, "한화 한타");
    return { ok: true, json: async () => profile() };
  };
  try {
    const api = createApi(async () => ({ serverUrl: "http://127.0.0.1:8787", token: "" }));
    await assert.rejects(api.suggestProfile({ request: "한화 한타" }), /판단 서버가 이전 버전/);
    assert.equal(urls.length, 1);
    supportsPrompts = true;
    await api.suggestProfile({ request: "한화 한타" });
    assert(urls.at(-1).endsWith("/suggest-profile"));
  } finally { globalThis.fetch = originalFetch; }
});

 test("generation follows a surviving slot when a preceding slot is deleted", async () => {
  let finish;
  const f = fixture(() => new Promise(resolve => { finish = resolve; }));
  f.slots.unshift({ tabId: 9 });
  const pending = f.controller.generate(1);
  await new Promise(resolve => setImmediate(resolve));
  f.slots.splice(0, 1);
  finish(profile());
  await pending;
  assert.equal(f.slots[0].alertSetup.status, "ready");
  assert.equal(f.applies(), 2, "listening starts first, then the answer applies");
});

test("내부 소리 기록은 조건 생성에 말소리로 보내지 않는다", async () => {
  let sent;
  const controller = createAutoProfiles({ api: { suggestProfile: async body => { sent = body.text; return profile(); } }, slots: () => [{ tabId: 1, title: "t", host: "h" }],
    transcript: () => "한타가 열립니다\n(소리 변화: 함성이나 고함 급등)\n바론으로 갑니다", publish: async () => {}, apply: async () => {} });
  await controller.generate(0);
  assert.equal(sent, "한타가 열립니다\n바론으로 갑니다");
});

 test("clearing unified keywords does not resurrect legacy suggestions", () => {
  const old = { name: "경기", keywords: ["바론"], watchPhrases: ["바론", "한타"], rules: [{text:"교전", enabled:true}] };
  assert.deepEqual(cleanAlertProfile(old).keywords, ["바론", "한타"]);
  const cleared = cleanAlertProfile({...old, keywordMode:"direct", keywords:[]});
  assert.deepEqual(cleared.keywords, []);
  assert.deepEqual(cleanAlertProfile(cleared).keywords, []);
});
