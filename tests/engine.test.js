import test from "node:test";
import assert from "node:assert/strict";
import { AudioEngine } from "../extension/engine.js";

function fixture({ contextOnly = false, speech = true, judge = async () => ({ important: true }) } = {}) {
  const events = [], calls = [];
  const engine = Object.create(AudioEngine.prototype);
  engine.emit = event => events.push(event);
  engine.api = { judge: async (...args) => { calls.push("judge"); return judge(...args); },
    summarize: async () => ({ summary: "판매가 시작됐습니다.", evidence: ["판매를 시작합니다."] }) };
  const channel = { id: 1, profile: { name: "판매", condition: "판매가 실제 시작되면", keywords: ["판매"], aliases: {}, contextOnly, requireEvidence: true },
    lines: speech ? [{ t: Date.now(), text: "판매를 시작합니다." }] : [], lastMomentAt: 0, lastMomentKind: null };
  engine.channels = new Map([[1, channel]]);
  return { engine, channel, events, calls };
}

test("main-tab context records transcripts without triggering keyword alerts or AI judgments", async () => {
  const f = fixture({ contextOnly: true });
  f.engine.onSpeech(f.channel, "판매를 시작합니다.");
  await f.engine.moment(f.channel, { kind: "judge" });
  assert.deepEqual(f.events.map(event => event.type), ["transcript"]);
  assert.equal(f.calls.length, 0);
});

test("automatic alerts require recognized evidence and a successful semantic judgment", async () => {
  for (const options of [{ speech: false }, { judge: async () => { throw new Error("offline"); } }, { judge: async () => ({ important: false }) }]) {
    const f = fixture(options);
    await f.engine.moment(f.channel, { kind: "surge" });
    assert(!f.events.some(event => event.type === "moment"));
  }
  const f = fixture();
  await f.engine.moment(f.channel, { kind: "judge" });
  assert.equal(f.events[0].type, "moment");
  assert.equal(f.events[0].moment.confident, true);
});

test("a pending judgment cannot alert after the profile is edited, focused, or disconnected", async () => {
  for (const change of [
    f => { f.channel.profile = { ...f.channel.profile, condition: "새 조건" }; },
    f => { f.channel.profile = { ...f.channel.profile, contextOnly: true }; },
    f => { f.engine.channels.delete(1); },
  ]) {
    let resolve;
    const f = fixture({ judge: () => new Promise(done => { resolve = done; }) });
    const pending = f.engine.moment(f.channel, { kind: "judge" });
    change(f);
    resolve({ important: true });
    await pending;
    assert.equal(f.events.length, 0);
  }
});

test("a superseded judgment cannot duplicate a keyword alert or erase its cooldown, even in the same millisecond", async t => {
  const now = Date.now();
  t.mock.method(Date, 'now', () => now);
  for (const outcome of [false, true, 'error']) {
    let resolve, reject;
    const f = fixture({ judge: () => new Promise((done, fail) => { resolve = done; reject = fail; }) });
    const pending = f.engine.moment(f.channel, { kind: 'judge' });
    await f.engine.moment(f.channel, { kind: 'keyword', keyword: '판매' });
    const count = f.events.length;
    assert.equal(f.channel.lastMomentAt, now);
    if (outcome === 'error') reject(new Error('offline'));
    else resolve({ important: outcome });
    await pending;
    assert.equal(f.events.length, count);
    assert.equal(f.channel.lastMomentAt, now);
  }
});

test("speech during the alert gap is judged afterwards, and alerted speech is never judged twice", async t => {
  let now = 1000000;
  t.mock.method(Date, "now", () => now);
  const seen = [];
  const f = fixture({ judge: async text => { seen.push(text); return { important: true }; } });
  f.channel.lastJudgedLine = 0;
  await f.engine.periodicJudge(f.channel, now);
  assert.equal(f.events.filter(event => event.type === "moment").length, 1);
  now += 3000;
  f.channel.lines.push({ t: now, text: "곧 결승타 찬스입니다." });
  await f.engine.periodicJudge(f.channel, now);
  assert.equal(seen.length, 1, "the gap postpones judging");
  now += 8000;
  await f.engine.periodicJudge(f.channel, now);
  assert.equal(seen.length, 2, "the postponed speech is not lost");
  assert.match(seen[1], /결승타/);
  assert(!seen[1].includes("판매를 시작합니다"), "alerted speech stays out of the next judgment");
  assert.equal(f.events.filter(event => event.type === "moment").length, 2);
  now += 11000;
  await f.engine.periodicJudge(f.channel, now);
  assert.equal(seen.length, 2, "no new speech, no repeat alert");
});

test("a slow judgment is not cancelled by the next cycle", async t => {
  let now = 1000000, resolve;
  t.mock.method(Date, "now", () => now);
  const f = fixture({ judge: () => new Promise(done => { resolve = done; }) });
  f.channel.lastJudgedLine = 0;
  const pending = f.engine.periodicJudge(f.channel, now);
  now += 5000;
  f.channel.lines.push({ t: now, text: "이어지는 말" });
  await f.engine.periodicJudge(f.channel, now);
  resolve({ important: true });
  await pending;
  assert.equal(f.calls.length, 1);
  assert.equal(f.events.filter(event => event.type === "moment").length, 1);
});

test("a keyword alerts inside the gap", async t => {
  let now = 1000000;
  t.mock.method(Date, "now", () => now);
  const f = fixture();
  await f.engine.moment(f.channel, { kind: "judge" });
  now += 2000;
  f.channel.lines.push({ t: now, text: "판매 시작" });
  await f.engine.moment(f.channel, { kind: "keyword", keyword: "판매" });
  assert.equal(f.events.filter(event => event.type === "moment").length, 2);
});
