import test from "node:test";
import assert from "node:assert/strict";

const realDate = Date.now;
globalThis.AudioContext ??= class {};
const { AudioEngine } = await import("../extension/engine.js");
const { alertProfileFor, cleanAlertProfile } = await import("../extension/lib/auto-profiles.js");

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

test("AI가 고른 표현은 바로 알리지 않고 판단을 거치며, 사람이 정한 키워드만 바로 알린다", async () => {
  const profile = alertProfileFor({ tabId: 1, alertSetup: { profile: cleanAlertProfile({ name: "야구", watchPhrases: ["기회"], rules: [{ text: "만루 찬스" }] }) } });
  assert.deepEqual(profile.keywords, []);
  assert.deepEqual(cleanAlertProfile({ keywords: ["끝내기"], rules: [{ text: "x" }] }).keywords, ["끝내기"]);
});

test("줄이 나뉘어도 키워드를 찾고 앞줄에서 찾은 단어는 다시 알리지 않는다", () => {
  const keywords = [];
  const engine = Object.create(AudioEngine.prototype);
  engine.emit = () => {};
  engine.moment = (_, { keyword }) => keywords.push(keyword);
  const channel = { id: 1, lines: [], profile: { keywords: ["시험 범위", "휴강"], aliases: {} } };
  engine.onSpeech(channel, "오늘은 시험");
  engine.onSpeech(channel, "범위를 말씀드립니다");
  engine.onSpeech(channel, "다음 주는 휴강입니다");
  engine.onSpeech(channel, "그렇게 알고 계세요");
  assert.deepEqual(keywords, ["시험 범위", "휴강"]);
});
