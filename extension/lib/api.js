// 판단 서버 호출. API 키는 서버에만 있고 확장에는 데모 토큰만 둔다.
export function createApi(getConfig) {
  async function post(path, body) {
    const { serverUrl, token } = await getConfig();
    const response = await fetch(serverUrl.replace(/\/$/, "") + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { "X-Demo-Token": token } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `server ${response.status}`);
    }
    return response.json();
  }
  return {
    judge: (text, condition) => post("/judge", { text, condition }),
    summarize: (text, focus) => post("/summarize", { text, focus }),
    classify: (host, title, topics) => post("/classify", { host, title, topics }),
    vision: (image, condition) => post("/vision", { image, condition }),
    profile: (request) => post("/profile", { request }),
  };
}
