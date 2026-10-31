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
