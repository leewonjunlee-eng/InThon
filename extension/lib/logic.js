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
    relatedWords: ["롤", "lck", "리그 오브 레전드", "league of legends", "발로란트", "오버워치", "스타크래프트", "esports", "e스포츠"],
    keywords: ["한타", "펜타킬", "쿼드라킬", "바론을 처치", "넥서스를 파괴", "교전 시작", "진입합니다", "연장전", "매치 포인트", "역전", "승리", "패배"],
    aliases: { 바론: ["발원", "발언", "바른", "발음"], 펜타킬: ["팬타킬", "팬타 킬", "켄타킬", "벤타킬", "펜타키", "펜타클"], 한타: ["한 타"] },
    previewText: "주요 교전, 목표 획득·역전, 승패 확정",
    condition: "1. 승부에 영향을 주는 교전이나 결정적인 공격을 시작하겠다고 말하는 순간\n2. 주요 목표를 차지하거나 방어하기 위한 시도를 예고하는 순간\n3. 불리하던 팀이나 선수가 흐름을 뒤집거나 역전에 성공했다고 말하는 순간\n4. 마지막 라운드의 승부가 나거나 최종 승리·패배가 확정됐다고 말하는 순간",
    summaryFocus: "주요 교전, 목표 획득, 승패와 경기 흐름",
  },
  {
    id: "baseball",
    name: "스포츠",
    relatedSites: ["koreabaseball.com", "statiz.co.kr", "mykbostats.com"],
    relatedWords: ["야구", "kbo", "프로야구", "축구", "농구", "배구", "스포츠", "프리미어리그", "nba"],
    keywords: ["득점", "골입니다", "홈런", "동점", "역전", "페널티킥", "매치 포인트", "끝내기"],
    aliases: {},
    previewText: "점수 변화, 결정적인 기회, 경기 결과",
    condition: "1. 득점이나 실점으로 경기 점수가 바뀌었다고 말하는 순간\n2. 동점이나 역전으로 앞서가는 팀 또는 선수가 달라졌다고 말하는 순간\n3. 페널티킥·만루·매치 포인트처럼 승부를 바꿀 기회가 생겼다고 말하는 순간\n4. 경기가 끝나고 최종 점수나 승리한 팀·선수가 확정됐다고 말하는 순간",
    summaryFocus: "점수 변화, 승부처, 최종 경기 결과",
  },
  {
    id: "lecture",
    name: "강의",
    relatedSites: ["blackboard.korea.ac.kr", "kulms.korea.ac.kr"],
    relatedWords: ["강의", "lecture", "수업"],
    keywords: ["시험에 나옵니다", "시험 범위", "제출 기한", "마감일", "평가 기준", "휴강", "보강"],
    aliases: {},
    previewText: "시험 안내, 과제·기한, 수업 일정 변경",
    condition: "1. 시험에 출제할 내용이나 시험 범위를 설명하겠다고 말하는 순간\n2. 시험 날짜·진행 방식이나 평가 기준을 안내하는 순간\n3. 과제를 내거나 제출 방법·마감 기한을 새로 안내하는 순간\n4. 휴강·보강 또는 수업 시간·장소를 변경하겠다고 말하는 순간",
    summaryFocus: "시험 범위와 일정, 과제 제출 기한, 수업 변경 사항",
  },
  {
    id: "meeting",
    name: "회의",
    relatedSites: ["meet.google.com", "zoom.us", "teams.microsoft.com"],
    relatedWords: ["회의", "meeting"],
    keywords: ["의견 주세요", "확인 부탁", "담당해 주세요", "결정하겠습니다", "확정하겠습니다", "마감일", "일정 변경"],
    aliases: {},
    previewText: "답변 요청, 담당자·기한 지정, 결정·변경 사항",
    condition: "1. 특정 참석자를 호명하거나 담당 업무를 언급하며 답변·의견을 요청하는 순간\n2. 진행할 업무의 담당자를 정하거나 누군가에게 맡기겠다고 말하는 순간\n3. 업무의 마감 기한이나 다음 회의·보고 일정을 정하는 순간\n4. 안건의 결론을 확정하거나 기존 일정·업무 범위를 바꾸겠다고 말하는 순간",
    summaryFocus: "답변 요청 대상, 담당자와 기한, 결정 및 변경 사항",
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
export function computeRoles({ slots, view, manual, peek, auto, confirmAuto = false }) {
  return slots.map((slot, i) => {
    if (slot.tabId === null) return null;
    if (peek !== null) return i === peek ? "main" : "standby";
    if (slot.pinned) return "main";
    if (manual !== null) return i === manual ? "main" : "standby";
    if (!auto) return "main";
    if (confirmAuto) return slot.role ?? "standby";
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
