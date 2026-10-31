import test from "node:test";
import assert from "node:assert/strict";

const realDate = Date.now;
globalThis.AudioContext ??= class {};
const { AudioEngine } = await import("../extension/engine.js");

function fixture(judge) {
  const events = [];
  const api = { judge, summarize: async () => ({ summary: "요약", evidence: [] }) };
  const engine = new AudioEngine({ api, emit: event => { events.push(event); } });
  const channel = { id: 1, lines: [], lastMomentAt: 0, profile: { name: "롤", condition: "바론을 시도하려 한다", summaryFocus: "", keywords: [], aliases: {}, watchPhrases: ["바론 쪽으로"], requireEvidence: true } };
  engine.channels.set(1, channel);
  return { engine, channel, events };
}

test("a watch phrase is judged at once, and only the AI can raise the alert", async () => {
  const seen = [];
  const f = fixture(async text => { seen.push(text); return { important: true }; });
  f.engine.onSpeech(f.channel, "이제 바론 쪽으로 움직입니다");
  await new Promise(resolve => setTimeout(resolve));
  assert.equal(seen.length, 1, "no wait for the 30 second judge");
  assert.equal(f.events.filter(event => event.type === "moment")[0].moment.kind, "watch");

  const rejected = fixture(async () => ({ important: false }));
  rejected.engine.onSpeech(rejected.channel, "바론 쪽으로 가지는 않습니다");
  await new Promise(resolve => setTimeout(resolve));
  assert(!rejected.events.some(event => event.type === "moment"));
});

test("repeated watch phrases do not flood the judge", async () => {
  let calls = 0;
  const f = fixture(async () => { calls++; return { important: false }; });
  try {
    let now = 1000000;
    Date.now = () => now;
    f.engine.onSpeech(f.channel, "바론 쪽으로 갑니다");
    await new Promise(resolve => setTimeout(resolve));
    now += 7000;
    f.engine.onSpeech(f.channel, "바론 쪽으로 계속 갑니다");
    await new Promise(resolve => setTimeout(resolve));
    assert.equal(calls, 1);
    now += 2000;
    f.engine.onSpeech(f.channel, "다시 바론 쪽으로 갑니다");
    await new Promise(resolve => setTimeout(resolve));
    assert.equal(calls, 2);
  } finally { Date.now = realDate; }
});
