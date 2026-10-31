// 소리 처리와 "대신 듣기" 엔진. 입력은 MediaStream이라 확장과 웹 체험 페이지가 함께 쓴다.
import { SURGE_DB, SurgeDetector, clock, correctTranscript, findKeyword, frameDiff, linesToText } from "./lib/logic.js";

import { transcriptExcerpt, normalizeSummary } from "./lib/summary.js";

const SR = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
const TICK_MS = 250;
const KEEP_MS = 30 * 60 * 1000;
const MOMENT_GAP_MS = 10000;
const WINDOW_MS = 30000;
const JUDGE_EVERY_MS = 5000;
const JUDGE_WINDOW_MS = 20000; // 알리지 않은 말은 문맥으로 남긴다. 알린 말은 moment()에서 뺀다.
const WATCH_WINDOW_MS = 15000; // 조짐 표현은 최근 말만 보고 바로 판단한다.
const WATCH_GAP_MS = 8000; // 표현이 몰려도 판단 호출이 쏟아지지 않게 한다.
const DIGEST_EVERY_MS = 5 * 60 * 1000;
const SURGE_WAIT_MS = 3000; // 함성 뒤에 나오는 자막까지 함께 판단한다.
const SURGE_RULE = "\n또는: 소리가 갑자기 커진 순간에 화자가 놀람, 환호, 흥분한 말투로 방금 벌어진 일을 전할 때";
const DUCK_DB = -38;
const INTERIM_CHARS = 24;
const SCREEN_EVERY_MS = 2000;
const SCREEN_GAP_MS = 15000;
const SCREEN_DIFF = 18;
const FATAL = new Set(["not-allowed", "service-not-allowed", "language-not-supported", "audio-capture"]);

export class AudioEngine {
  constructor({ api, emit }) {
    this.api = api;
    this.emit = emit;
    this.context = new AudioContext();
    this.channels = new Map();
    this.duck = false;
  }

  async add(id, stream) {
    await this.context.resume();
    const source = this.context.createMediaStreamSource(stream);
    const gain = this.context.createGain();
    const panner = this.context.createStereoPanner();
    const analyser = this.context.createAnalyser();
    analyser.fftSize = 16384; // 0.25초 간격을 덮는 길이라 음절 사이 틈을 재지 않는다.
    // 캡처하면 원래 탭 소리가 꺼지므로 출력으로 다시 연결한다.
    source.connect(gain).connect(panner).connect(this.context.destination);
    source.connect(analyser);
    const channel = {
      id, stream, source, gain, panner, analyser,
      samples: new Float32Array(analyser.fftSize),
      target: 1, db: -Infinity, profile: null, stopRecognition: null,
      lines: [], digests: [], listenedAt: 0, lastDigestAt: 0, lastJudgeAt: 0, lastJudgedLine: 0, lastMomentAt: 0,
      detector: null, health: { audio:"ready", speech:"off", judge:"idle", screen:"idle", at:Date.now() },
    };
    channel.timer = setInterval(() => this.tick(channel), TICK_MS);
    this.channels.set(id, channel);
    stream.getAudioTracks().forEach(track => track.addEventListener?.("ended", () => {
      channel.health.audio = "error"; this.reportHealth(channel);
    }));
    this.reportHealth(channel);
  }

  reportHealth(channel) {
    if (!channel.health || (this.channels && this.channels.get(channel.id) !== channel)) return;
    channel.health.at = Date.now();
    this.emit({ type:"monitor", id:channel.id, health:{ ...channel.health } });
  }
  async monitored(channel, kind, work) {
    if (!channel.health) return work();
    const token = Symbol();
    channel.healthTokens ??= {};
    channel.healthTokens[kind] = token;
    channel.health[kind] = "pending";
    const timer = setTimeout(() => {
      if (channel.healthTokens[kind] !== token) return;
      channel.health[kind] = "delay"; this.reportHealth(channel);
    }, 5000);
    try {
      const result = await work();
      if (channel.healthTokens[kind] === token) channel.health[kind] = "ready";
      return result;
    } catch (error) {
      if (channel.healthTokens[kind] === token) {
        channel.health[kind] = "error";
        channel.health[kind + "Error"] = kind === "screen" ? "화면 판단 오류 · 소리 조절 가능" : "AI 판단 오류 · 소리 조절 가능";
      }
      throw error;
    } finally { clearTimeout(timer); this.reportHealth(channel); }
  }
  retry(id) {
    const channel = this.channels.get(id);
    if (!channel || channel.stream.getAudioTracks().some(t => t.readyState === "ended")) throw new Error("소리 연결을 해제한 뒤 다시 연결해주세요.");
    channel.stopRecognition?.();
    channel.health.judge = "idle"; channel.health.screen = "idle";
    channel.lastJudgeAt = 0; channel.lastJudgedLine = 0;
    if (channel.profile) channel.stopRecognition = this.recognize(channel);
    this.reportHealth(channel);
  }

  remove(id) {
    const channel = this.channels.get(id);
    if (!channel) return;
    clearInterval(channel.timer);
    channel.stopRecognition?.();
    channel.stopScreen?.();
    channel.stream.getTracks().forEach((track) => track.stop());
    channel.source.disconnect();
    channel.gain.disconnect();
    channel.panner.disconnect();
    this.channels.delete(id);
  }

  setOutput(id, { gain, pan }) {
    const channel = this.channels.get(id);
    if (!channel) return;
    channel.target = gain;
    channel.ducked = false;
    this.fade(channel, gain);
    channel.panner.pan.setTargetAtTime(pan, this.context.currentTime, 0.02);
  }

  fade(channel, value) {
    channel.gain.gain.setTargetAtTime(value, this.context.currentTime, 0.08);
  }

  chime(pan) {
    const now = this.context.currentTime;
    const tone = this.context.createOscillator();
    const level = this.context.createGain();
    const panner = this.context.createStereoPanner();
    tone.frequency.value = 880;
    panner.pan.value = pan;
    level.gain.setValueAtTime(0.0001, now);
    level.gain.exponentialRampToValueAtTime(0.25, now + 0.02);
    level.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
    tone.connect(level).connect(panner).connect(this.context.destination);
    tone.start(now);
    tone.stop(now + 0.32);
  }

  setListen(id, profile, sensitivity = "normal", screen = false) {
    const channel = this.channels.get(id);
    if (!channel) return;
    if (channel.health) channel.health.alertEnabled = Boolean(profile && !profile.contextOnly);
    const watch = Boolean(profile && !profile.contextOnly && screen);
    if (watch !== Boolean(channel.stopScreen)) {
      channel.stopScreen?.();
      channel.stopScreen = watch ? this.watchScreen(channel) : null;
    }
    if (profile && channel.profile) {
      if (!channel.profile.contextOnly && profile.contextOnly) this.returnSummary(channel, channel.profile);
      if (channel.profile.contextOnly && !profile.contextOnly) {
        channel.lines = [];
        channel.digests = [];
        channel.lastJudgedLine = 0;
        channel.listenedAt = channel.lastDigestAt = channel.lastJudgeAt = Date.now();
      }
      channel.profile = profile;
      channel.detector.thresholdDb = SURGE_DB[sensitivity];
      return;
    }
    if (profile) {
      channel.profile = profile;
      channel.detector = new SurgeDetector({ thresholdDb: SURGE_DB[sensitivity] });
      channel.lines = [];
      channel.digests = [];
      channel.listenedAt = channel.lastDigestAt = channel.lastJudgeAt = Date.now();
      channel.stopRecognition = this.recognize(channel);
    } else if (channel.profile) {
      const finished = channel.profile;
      channel.stopRecognition?.();
      channel.stopRecognition = null;
      channel.profile = null;
      if (!finished.contextOnly) this.returnSummary(channel, finished);
    }
  }

  // 탭 화면을 작게 줄여 비교하고, 장면이 크게 바뀔 때만 이미지를 LLM에 보낸다.
  watchScreen(channel) {
    const track = channel.stream.getVideoTracks()[0];
    if (!track) return null;
    const video = document.createElement("video");
    video.muted = true;
    video.srcObject = new MediaStream([track]);
    video.play().catch(() => {});
    channel.screen = { video, ticks: 0, diff: 0 }; // 개발자 도구 확인용
    const small = new OffscreenCanvas(64, 36).getContext("2d", { willReadFrequently: true });
    let previous = null;
    let lastSent = 0;
    const timer = setInterval(() => {
      if (video.readyState < 2) return;
      small.drawImage(video, 0, 0, 64, 36);
      const { data } = small.getImageData(0, 0, 64, 36);
      const diff = previous ? frameDiff(previous, data) : 0;
      Object.assign(channel.screen, { ticks: channel.screen.ticks + 1, diff });
      const changed = diff >= SCREEN_DIFF;
      previous = data;
      if (changed && Date.now() - lastSent >= SCREEN_GAP_MS) {
        lastSent = Date.now();
        this.checkFrame(channel, video);
      }
    }, SCREEN_EVERY_MS);
    return () => {
      clearInterval(timer);
      video.srcObject = null;
    };
  }

  async checkFrame(channel, video) {
    const canvas = document.createElement("canvas");
    canvas.width = 480;
    canvas.height = 270;
    canvas.getContext("2d").drawImage(video, 0, 0, 480, 270);
    const { name, condition } = channel.profile ?? {};
    if (!condition) return;
    try {
      const { important, summary } = await this.monitored(channel, "screen", () => this.api.vision(canvas.toDataURL("image/jpeg", 0.6), condition));
      this.addLine(channel, `(화면 변화: ${summary})`);
      if (!important || channel.profile?.contextOnly || channel.profile?.condition !== condition || this.channels.get(channel.id) !== channel) return;
      const now = Date.now();
      channel.lastMomentAt = now;
      this.emit({
        type: "moment",
        moment: { id: `${channel.id}-${now}`, tabId: channel.id, topic: name, time: clock(now), kind: "screen", keyword: null, confident: true, summary, evidence: [] },
      });
    } catch {
      this.emit({ type: "status", id: channel.id, text: "화면 판단 서버에 연결하지 못했습니다." });
    }
  }

  recognize(channel) {
    const status = (value, error = "") => {
      if (!channel.health) return;
      channel.health.speech = value;
      if (error) channel.health.speechError = error;
      this.reportHealth(channel);
    };
    status("preparing");
    const track = channel.stream.getAudioTracks()[0];
    if (!SR || !track) {
      status("error", "음성 인식을 사용할 수 없어요");
      this.emit({ type: "status", id: channel.id, text: "음성 인식을 쓸 수 없어 소리 변화만 감지합니다." });
      return null;
    }
    let live = true;
    const recognition = new SR();
    recognition.lang = "ko-KR";
    recognition.continuous = true;
    recognition.interimResults = true;
    let committed = 0;
    // 배경 소음이 있으면 문장 끝을 못 찾아 최종 결과가 오래 지연되므로 중간 결과도 나눠서 기록한다.
    recognition.onstart = () => status("ready");
    recognition.onresult = (event) => {
      status("ready");
      if (channel.health) channel.health.lastSpeechAt = Date.now();
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const text = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          this.onSpeech(channel, text.slice(committed).trim());
          committed = 0;
        } else if (text.length - committed >= INTERIM_CHARS) {
          const cut = text.lastIndexOf(" ");
          if (cut > committed) {
            this.onSpeech(channel, text.slice(committed, cut).trim());
            committed = cut;
          }
        }
      }
    };
    recognition.onerror = (event) => {
      if (event.error === "no-speech" || event.error === "aborted") return;
      status("error", `음성 인식 오류 (${event.error})`);
      if (!FATAL.has(event.error)) return;
      live = false;
      this.emit({ type: "status", id: channel.id, text: `음성 인식 오류(${event.error}). 소리 변화만 감지합니다.` });
    };
    // 연속 인식도 침묵이나 네트워크 문제로 끝날 수 있어 다시 시작한다.
    recognition.onend = () => {
      if (live && track.readyState === "live") setTimeout(() => { if (live) { try { recognition.start(track); } catch { status("error", "음성 인식 재시작 실패"); } } }, 200);
    };
    try { recognition.start(track); }
    catch (error) { live = false; status("error", `음성 인식 시작 실패 (${error.name})`); }
    return () => {
      live = false;
      recognition.abort();
    };
  }

  addLine(channel, text) {
    const now = Date.now();
    channel.lines.push({ t: now, text });
    while (channel.lines.length && now - channel.lines[0].t > KEEP_MS) channel.lines.shift();
    this.emit({ type: "transcript", id: channel.id, time: clock(now), text });
  }

  onSpeech(channel, raw) {
    if (!raw || !channel.profile) return;
    const text = correctTranscript(raw, channel.profile.aliases);
    this.addLine(channel, text);
    if (channel.profile.contextOnly) return;
    const keyword = findKeyword(text, channel.profile.keywords);
    if (keyword) return this.moment(channel, { kind: "keyword", keyword });
    const now = Date.now();
    if (findKeyword(text, channel.profile.watchPhrases ?? []) && now - (channel.lastWatchAt ?? 0) >= WATCH_GAP_MS) {
      channel.lastWatchAt = now;
      this.moment(channel, { kind: "watch" });
    }
  }

  tick(channel) {
    if (channel.health && Date.now() - channel.health.at >= 5000) this.reportHealth(channel);
    channel.analyser.getFloatTimeDomainData(channel.samples);
    const power = channel.samples.reduce((sum, value) => sum + value * value, 0) / channel.samples.length;
    channel.db = 10 * Math.log10(power);
    if (this.duck) this.applyDuck();
    if (!channel.profile || channel.profile.contextOnly) return;
    const now = Date.now();
    if (channel.detector.push(channel.db, now)) {
      this.addLine(channel, "(소리 변화: 함성이나 고함 급등)");
      setTimeout(() => this.moment(channel, { kind: "surge" }), SURGE_WAIT_MS);
    }
    if (now - channel.lastJudgeAt >= JUDGE_EVERY_MS) this.periodicJudge(channel, now);
    if (now - channel.lastDigestAt >= DIGEST_EVERY_MS) this.digest(channel, now);
  }

  // 메인 소리가 크게 나는 동안 대기 소리를 더 낮춘다.
  applyDuck() {
    const channels = [...this.channels.values()];
    const loudest = Math.max(...channels.map((channel) => channel.target));
    const talking = channels.some((channel) => channel.target === loudest && channel.db > DUCK_DB);
    for (const channel of channels) {
      const ducked = talking && channel.target < loudest;
      if (ducked !== channel.ducked) this.fade(channel, ducked ? channel.target / 2 : channel.target);
      channel.ducked = ducked;
    }
  }

  recent(channel, sinceMs = WINDOW_MS) {
    const since = Date.now() - sinceMs;
    return channel.lines.filter((line) => line.t >= since);
  }

  async periodicJudge(channel, now) {
    channel.lastJudgeAt = now;
    // 간격 중이거나 앞 판단이 끝나지 않았으면 말을 소비하지 않아 다음 주기에 그대로 판단한다.
    if (channel.judging || now - channel.lastMomentAt < MOMENT_GAP_MS) return;
    const fresh = channel.lines.slice(channel.lastJudgedLine);
    if (!fresh.length) return;
    channel.lastJudgedLine = channel.lines.length;
    channel.judging = true;
    try { await this.moment(channel, { kind: "judge" }); }
    finally { channel.judging = false; }
  }

  async moment(channel, { kind, keyword = null }) {
    if (!channel.profile || channel.profile.contextOnly) return;
    const now = Date.now();
    // 지정 단어는 말 그대로 확인된 신호라 간격 제한을 받지 않는다.
    if (kind !== "keyword" && now - channel.lastMomentAt < MOMENT_GAP_MS) return;
    const { condition, summaryFocus, name } = channel.profile;
    const alertedBefore = channel.lastMomentAt;
    // 판단 중 다른 알림이 나갔다면 그 말은 이미 알린 것이다. 이후의 말은 다음 주기에 판단한다.
    const current = () => channel.lastMomentAt === alertedBefore && this.channels.get(channel.id) === channel && channel.profile && !channel.profile.contextOnly && channel.profile.condition === condition;
    const lines = this.recent(channel, { watch: WATCH_WINDOW_MS, judge: JUDGE_WINDOW_MS }[kind] ?? WINDOW_MS)
      .filter(line => line.t > channel.lastMomentAt);
    const text = linesToText(lines);
    const hasSpeech = lines.some((line) => !line.text.startsWith("("));
    const gated = kind === "judge" || kind === "watch"; // AI가 확인해야만 알린다.
    if (gated && !hasSpeech) return;
    if (channel.profile.requireEvidence && !hasSpeech) return;
    let confident = kind === "keyword";

    if (!confident && hasSpeech) {
      try {
        const { important } = await this.monitored(channel, "judge", () => this.api.judge(text, kind === "surge" ? condition + SURGE_RULE : condition));
        if (!important || !current()) return;
        confident = true;
      } catch {
        if (!current() || gated || channel.profile?.requireEvidence) return;
      }
    }
    if (gated && !confident) return;
    if (!hasSpeech) lines.length = 0;

    const fallback = transcriptExcerpt(lines);
    const moment = {
      id: `${channel.id}-${now}`, tabId: channel.id, topic: name, time: clock(now), kind, keyword, confident,
      ...fallback, summaryStatus: hasSpeech ? "loading" : "no-transcript",
    };
    // Show the event immediately; enrich this same alert when the model finishes.
    if (!current()) return;
    channel.lastMomentAt = Date.now();
    await this.emit({ type: "moment", moment: { ...moment } });
    if (!hasSpeech) return;
    try {
      const result = normalizeSummary(await this.api.summarize(text, summaryFocus), lines);
      Object.assign(moment, result, { summaryStatus: "ai" });
    } catch {
      Object.assign(moment, fallback, { summaryStatus: "fallback" });
    }
    // This only enriches the already-emitted historical event. Content and
    // notification update handlers never reopen a dismissed/replaced alert.
    await this.emit({ type: "moment-update", moment });
  }

  async digest(channel, now) {
    const lines = channel.lines.filter((line) => line.t >= channel.lastDigestAt);
    channel.lastDigestAt = now;
    if (!lines.length) return;
    try {
      const { summary } = await this.api.summarize(linesToText(lines), channel.profile.summaryFocus);
      channel.digests.push(`[${clock(lines[0].t)} 이후] ${summary}`);
    } catch {
      channel.digests.push(linesToText(lines.slice(-5)));
    }
  }

  async returnSummary(channel, profile) {
    const lines = channel.lines.filter((line) => line.t >= channel.lastDigestAt);
    const speech = channel.digests.length + lines.length;
    if (speech < 2) return;
    const minutes = Math.max(1, Math.round((Date.now() - channel.listenedAt) / 60000));
    const text = [...channel.digests, linesToText(lines)].join("\n");
    try {
      const { summary, evidence } = await this.api.summarize(text, profile.summaryFocus);
      this.emit({ type: "return-summary", id: channel.id, minutes, summary, evidence: evidence.map(String) });
    } catch {
      this.emit({ type: "return-summary", id: channel.id, minutes, summary: "요약 서버에 연결하지 못했습니다.", evidence: lines.slice(-3).map((line) => line.text) });
    }
  }
}
