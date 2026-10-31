import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SETTINGS, PROFILES, SURGE_DB, SurgeDetector, classify, computeRoles, correctTranscript, emptySlot, findKeyword, frameDiff, gainFor, hostOf,
} from "../extension/lib/logic.js";

const lol = { ...emptySlot(), tabId: 1, topic: "롤" };
const other = { ...emptySlot(), tabId: 2, topic: "강의" };
const base = { slots: [lol, other], manual: null, peek: null, auto: true };
const view = (tabId, topic, focused = true) => ({ tabId, topic, focused });

test("보고 있는 탭과 같은 주제의 소리는 메인을 유지한다", () => {
  assert.deepEqual(computeRoles({ ...base, view: view(1, "롤") }), ["main", "standby"]);
  assert.deepEqual(computeRoles({ ...base, view: view(9, "롤") }), ["main", "standby"]);
});

test("다른 일을 보거나 크롬 밖이면 대기로 내려간다", () => {
  assert.deepEqual(computeRoles({ ...base, view: view(9, "과제") }), ["standby", "standby"]);
  assert.deepEqual(computeRoles({ ...base, view: view(9, "기타") }), ["standby", "standby"]);
  assert.deepEqual(computeRoles({ ...base, view: view(1, "롤", false) }), ["standby", "standby"]);
});

test("우선순위는 잠깐 확인, 고정, 수동 집중, 자동 순서다", () => {
  const pinned = { ...lol, pinned: true };
  const slots = [pinned, other];
  assert.deepEqual(computeRoles({ ...base, slots, peek: 1, view: view(9, "과제") }), ["standby", "main"]);
  assert.deepEqual(computeRoles({ ...base, slots, view: view(9, "과제") }), ["main", "standby"]);
  assert.deepEqual(computeRoles({ ...base, manual: 1, view: view(1, "롤") }), ["standby", "main"]);
});

test("빈 슬롯에는 역할이 없고 자동을 끄면 모두 메인이다", () => {
  assert.deepEqual(computeRoles({ ...base, slots: [lol, emptySlot()], view: view(9, "과제") }), ["standby", null]);
  assert.deepEqual(computeRoles({ ...base, auto: false, view: view(9, "과제") }), ["main", "main"]);
});

test("음량은 역할별로 적용되고 음소거가 우선한다", () => {
  assert.equal(gainFor(lol, "main", DEFAULT_SETTINGS), 0.8);
  assert.equal(gainFor(lol, "standby", DEFAULT_SETTINGS), 0.15);
  assert.equal(gainFor(lol, "standby", { ...DEFAULT_SETTINGS, bgMute: true }), 0);
  assert.equal(gainFor({ ...lol, muted: true }, "main", DEFAULT_SETTINGS), 0);
});

test("탭 분류는 사용자 규칙, 사이트, 단어 순서다", () => {
  assert.equal(classify({ url: "https://www.op.gg/x", title: "전적" }, {}, PROFILES), "게임");
  assert.equal(classify({ url: "https://kr.op.gg/x", title: "" }, {}, PROFILES), "게임");
  assert.equal(classify({ url: "https://www.youtube.com/w", title: "LCK 결승 생중계" }, {}, PROFILES), "게임");
  assert.equal(classify({ url: "https://www.op.gg/x", title: "" }, { "op.gg": "과제" }, PROFILES), "과제");
  assert.equal(classify({ url: "https://docs.google.com/d", title: "운영체제 보고서" }, {}, PROFILES), null);
  assert.equal(hostOf("chrome://extensions"), "extensions");
  assert.equal(hostOf("not a url"), "");
});

test("화면 차이는 같은 장면이면 0, 완전히 바뀌면 크다", () => {
  const black = new Uint8ClampedArray(16).fill(0);
  const white = new Uint8ClampedArray(16).fill(255);
  assert.equal(frameDiff(black, black), 0);
  assert.equal(frameDiff(black, white), 255);
});

test("음성 인식 오류를 보정하면 키워드를 찾는다", () => {
  const { aliases, keywords } = PROFILES[0];
  const text = correctTranscript("블루팀이 발언을 처치합니다", aliases);
  assert.equal(text, "블루팀이 바론을 처치합니다");
  assert.equal(findKeyword(correctTranscript("팬타 킬 나왔습니다", aliases), keywords), "펜타킬");
  assert.equal(findKeyword("조용한 라인전입니다", keywords), null);
  assert.equal(findKeyword("블루팀이 바론 쪽으로 움직입니다", keywords), null, "이동만으로는 알리지 않음");
  assert.equal(findKeyword(correctTranscript("블루팀이 발음을 처치합니다", aliases), keywords), "바론을 처치");
});

test("소리 급등은 말 사이 틈으로 끊기지 않고 작은 상승도 잡는다", () => {
  const detector = new SurgeDetector({ thresholdDb: SURGE_DB.normal });
  let now = 0;
  const feed = (...levels) => levels.map((db) => detector.push(db, now += 250)).some(Boolean);
  assert.equal(feed(...Array(30).fill(-30)), false);
  assert.equal(feed(-25, -25, -30, -25, -25), true, "한 틱 끊겨도 5dB 상승을 잡는다");
});

test("음량이 계속 커진 상태면 기준선이 따라가 반복 감지하지 않는다", () => {
  const detector = new SurgeDetector();
  let now = 0;
  const hits = Array.from({ length: 400 }, (_, i) => detector.push(i < 40 ? -30 : -15, now += 250)).filter(Boolean);
  assert(hits.length <= 3, `감지 ${hits.length}번`);
});

test("소리 급등은 지속될 때 한 번만 감지하고 재사용 대기를 지킨다", () => {
  const detector = new SurgeDetector({ cooldownMs: 15000 });
  let now = 0;
  const feed = (db, count) => {
    const hits = [];
    for (let i = 0; i < count; i++) {
      now += 250;
      if (detector.push(db, now)) hits.push(now);
    }
    return hits;
  };
  assert.equal(feed(-30, 30).length, 0);
  assert.equal(feed(-29, 2).length, 0);
  assert.equal(feed(-15, 2).length, 0, "짧은 소리는 무시");
  assert.equal(feed(-30, 2).length, 0);
  assert.equal(feed(-15, 8).length, 1, "긴 급등은 한 번");
  assert.equal(feed(-30, 70).length, 0);
  assert.equal(feed(-15, 4).length, 1, "대기 후 다시 감지");
  assert.equal(detector.push(-Infinity, now), false);
});

test("받아쓰기 오차는 긴 단어만 허용하고 짧은 단어는 정확히 맞아야 한다", () => {
  assert.equal(findKeyword("글루핑 원딜이 살아남습니다 펜타클", ["펜타킬"]), "펜타킬");
  assert.equal(findKeyword("바론을 처지합니다", ["바론을 처치"]), "바론을 처치");
  assert.equal(findKeyword("끝내지 않았습니다", ["끝내기"]), null);
  assert.equal(findKeyword("한 번 더 기다려 봅니다", ["한타", "역전", "홈런"]), null);
});
