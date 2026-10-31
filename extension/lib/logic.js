// 크롬 API에 의존하지 않는 순수 로직. tests/logic.test.js에서 그대로 시험한다.
import { SERVER_CONFIG } from "../server-config.js";
export const DEFAULT_SETTINGS = {
  focusVol: 80,
  bgVol: 15,
  bgMute: false,
  auto: true,
  dnd: false,
  duck: false,
  screen: false,
  sensitivity: "normal",
  serverUrl: SERVER_CONFIG.serverUrl,
  token: SERVER_CONFIG.token,
};

export const SURGE_DB = { low: 12, normal: 9, high: 6 };

export const PROFILES = [
  {
    id: "lol",
    name: "게임",
    relatedSites: ["op.gg", "fow.kr", "inven.co.kr", "lol.ps", "leagueoflegends.com"],
    relatedWords: ["롤", "lck", "리그 오브 레전드", "league of legends"],
    keywords: ["한타", "펜타킬", "쿼드라킬", "바론을 처치", "넥서스를 파괴"],
    aliases: { 바론: ["발원", "발언", "바른", "발음"], 펜타킬: ["팬타킬", "팬타 킬", "켄타킬", "벤타킬", "펜타키", "펜타클"], 한타: ["한 타"] },
    condition: "승부에 영향을 주는 교전이나 오브젝트 획득",
    summaryFocus: "교전 결과, 오브젝트, 경기 흐름",
  },
  {
    id: "baseball",
    name: "스포츠",
    relatedSites: ["koreabaseball.com", "statiz.co.kr", "mykbostats.com"],
    relatedWords: ["야구", "kbo", "프로야구"],
    keywords: ["홈런", "만루", "끝내기", "역전"],
    aliases: {},
    condition: "득점이나 역전, 득점 찬스",
    summaryFocus: "점수 변화, 주자 상황",
  },
  {
    id: "lecture",
    name: "강의",
    relatedSites: ["blackboard.korea.ac.kr", "kulms.korea.ac.kr"],
    relatedWords: ["강의", "lecture", "수업"],
    keywords: ["시험에 나옵니다", "시험에 나와요", "과제", "중요합니다"],
    aliases: {},
    condition: "시험, 과제, 공지처럼 놓치면 안 되는 안내",
    summaryFocus: "공지, 핵심 개념",
  },
  {
    id: "meeting",
    name: "회의",
    relatedSites: ["meet.google.com", "zoom.us", "teams.microsoft.com"],
    relatedWords: ["회의", "meeting"],
    keywords: [],
    aliases: {},
    condition: "사용자의 이름이나 담당 업무가 언급되고 답변이 필요한 순간",
    summaryFocus: "나에게 요청된 일, 결정 사항",
  },
];

export const emptySlot = (settings = DEFAULT_SETTINGS) => ({
  tabId: null,
  title: "",
  host: "",
  topic: null,
  pinned: false,
  pan: 0,
  muted: false,
  volumes: { main: settings.focusVol, standby: settings.bgVol },
  profileId: null,
  role: null,
});

export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

// 재생 위치나 앵커만 바뀐 것은 같은 페이지로 본다.
export function pageKey(url) {
  try {
    const page = new URL(url);
    page.hash = "";
    page.searchParams.delete("t");
    return page.href;
  } catch {
    return "";
  }
}

export function classify({ url, title }, rules, profiles) {
  const host = hostOf(url);
  if (rules[host]) return rules[host];
  const lowered = (title || "").toLowerCase();
  for (const profile of profiles) {
    if (profile.relatedSites.some((site) => host === site || host.endsWith(`.${site}`))) return profile.name;
    if (profile.relatedWords.some((word) => lowered.includes(word.toLowerCase()))) return profile.name;
  }
  return null;
}

// 잠깐 확인 > 고정 > 수동 집중 > 보는 탭 기준 자동 전환
export function computeRoles({ slots, view, manual, peek, auto }) {
  return slots.map((slot, i) => {
    if (slot.tabId === null) return null;
    if (peek !== null) return i === peek ? "main" : "standby";
    if (slot.pinned) return "main";
    if (manual !== null) return i === manual ? "main" : "standby";
    if (!auto) return "main";
    if (!view.focused) return "standby";
    if (view.tabId === slot.tabId) return "main";
    const shared = view.topic && view.topic !== "기타" && view.topic === slot.topic;
    return shared ? "main" : "standby";
  });
}

export function gainFor(slot, role, settings) {
  if (!role || slot.muted) return 0;
  if (role === "standby" && settings.bgMute) return 0;
  return slot.volumes[role] / 100;
}

export function correctTranscript(text, aliases = {}) {
  let result = text;
  for (const [word, wrongs] of Object.entries(aliases)) {
    for (const wrong of wrongs) result = result.split(wrong).join(word);
  }
  return result;
}

const compact = (text) => text.replace(/\s+/g, "").toLowerCase();

export function findKeyword(text, keywords) {
  const haystack = compact(text);
  return keywords.find((word) => haystack.includes(compact(word))) ?? null;
}

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

// 소리 크기가 최근 기준보다 일정 시간 크게 높으면 급등으로 본다. 4Hz 입력 기준.
export class SurgeDetector {
  constructor({ thresholdDb = SURGE_DB.normal, windowSize = 120, sustain = 3, cooldownMs = 15000 } = {}) {
    Object.assign(this, { thresholdDb, windowSize, sustain, cooldownMs });
    this.history = [];
    this.over = 0;
    this.lastAt = -Infinity;
  }

  push(db, now) {
    if (!Number.isFinite(db)) return false;
    let surged = false;
    if (this.history.length >= 20) {
      this.over = db > median(this.history) + this.thresholdDb ? this.over + 1 : 0;
      if (this.over >= this.sustain && now - this.lastAt >= this.cooldownMs) {
        this.lastAt = now;
        this.over = 0;
        surged = true;
      }
    }
    // 급등 구간이 기준선을 끌어올리지 않도록 평소 소리만 기록한다.
    if (this.over === 0) {
      this.history.push(db);
      if (this.history.length > this.windowSize) this.history.shift();
    }
    return surged;
  }
}

// 축소한 RGBA 화면 두 장의 평균 밝기 차이(0~255). 장면이 크게 바뀌면 값이 커진다.
export function frameDiff(previous, current) {
  let total = 0;
  for (let i = 0; i < current.length; i += 4) {
    const before = (previous[i] + previous[i + 1] + previous[i + 2]) / 3;
    const after = (current[i] + current[i + 1] + current[i + 2]) / 3;
    total += Math.abs(after - before);
  }
  return total / (current.length / 4);
}

export const clock = (time) => new Date(time).toTimeString().slice(0, 8);

export const linesToText = (lines) => lines.map((line) => `[${clock(line.t)}] ${line.text}`).join("\n");

// Cycle through connected slots, skipping any empty slots.
export function nextConnectedSlot(slots, current) {
  for (let offset = 1; offset <= slots.length; offset++) {
    const index = (Math.max(-1, current) + offset) % slots.length;
    if (slots[index].tabId !== null) return index;
  }
  return -1;
}
