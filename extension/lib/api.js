// 판단 서버 호출. API 키는 서버에만 있고 확장에는 데모 토큰만 둔다.
import { normalizeConnection } from "./connection.js";
export function createApi(getConfig) {
  async function fetchServer(url, init) {
    try { return await fetch(url, init); }
    catch (error) {
      if (error.name === "TimeoutError" || error.name === "AbortError") throw new Error("AI 서버 응답 시간이 초과됐습니다. 잠시 후 다시 시도해 주세요.");
      throw new Error("AI 서버에 연결할 수 없습니다. 다른 PC에서는 공용 서버 주소를 설정해 주세요.");
    }
  }
  async function health() {
    const { serverUrl } = normalizeConnection(await getConfig());
    const response = await fetchServer(serverUrl + "/health", { signal: AbortSignal.timeout(10000) });
    const info = await response.json().catch(() => ({}));
    if (!response.ok || info?.ok !== true) throw new Error("AI 서버 주소를 확인해 주세요. 정상적인 서버 응답이 아닙니다.");
    return info;
  }
  async function post(path, body) {
    const { serverUrl, token } = normalizeConnection(await getConfig());
    const restartMessage = "판단 서버가 이전 버전입니다. 실행 중인 서버를 종료하고 python server/server.py로 다시 시작한 뒤 AI로 다시 제안받기를 눌러 주세요.";
    if (path === "/suggest-profile" && body.request) {
      const info = await health();
      if (!info.capabilities?.includes("prompt-alerts")) throw new Error(restartMessage);
    }
    const response = await fetchServer(serverUrl + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { "X-Demo-Token": token } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(path === "/suggest-profile" ? 65000 : 20000),
    });
    if (!response.ok) {
      if (path === "/suggest-profile" && response.status === 404) {
        throw new Error(restartMessage);
      }
      const body = await response.json().catch(() => ({}));
      if (response.status === 401) throw new Error(body.error || "AI 서버 접속 토큰이 올바르지 않습니다.");
      throw new Error(body.error || `server ${response.status}`);
    }
    return response.json();
  }
  return {
    checkConnection: async () => {
      const info = await health();
      if (!info.aiReady) throw new Error("공용 서버에 레블업 API 연결 정보가 설정되지 않았습니다.");
      await post("/check", {});
      return info;
    },
    judge: (text, condition) => post("/judge", { text, condition }),
    summarize: (text, focus) => post("/summarize", { text, focus }),
    classify: (host, title, topics) => post("/classify", { host, title, topics }),
    vision: (image, condition) => post("/vision", { image, condition }),
    profile: (request) => post("/profile", { request }),
    suggestProfile: (context) => post("/suggest-profile", context),
  };
}
