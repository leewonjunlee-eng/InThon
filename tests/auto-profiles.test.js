import test from "node:test";
import assert from "node:assert/strict";
import { alertProfileFor, cleanAlertProfile, createAutoProfiles } from "../extension/lib/auto-profiles.js";

const profile = (name = "판매 방송") => ({ name, summaryFocus: "가격과 판매 일정", rules: [
  { text: "최종 가격이 실제 공개되었을 때", enabled: true },
  { text: "판매 시작 시각이 확정되었을 때", enabled: false },
] });
function fixture(suggestProfile = async () => profile()) {
  const slots = [{ tabId: 10, title: "신제품 공개 라이브", host: "example.com" }];
  let context = "", applies = 0;
  const controller = createAutoProfiles({ api: { suggestProfile }, slots: () => slots,
    transcript: () => context, publish: async () => {}, apply: async () => { applies++; },
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
  assert.equal(alertProfileFor(f.slots[0]).condition, "최종 가격이 실제 공개되었을 때");
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
