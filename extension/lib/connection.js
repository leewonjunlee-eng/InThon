export function normalizeConnection({ serverUrl, token = "" }) {
  let url;
  try { url = new URL(String(serverUrl).trim()); }
  catch { throw new Error("AI 서버 주소를 http:// 또는 https://로 입력해 주세요."); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("서버 주소에는 http(s) 주소만 입력해 주세요. 인증 정보나 쿼리는 넣지 마세요.");
  }
  return { serverUrl: url.href.replace(/\/+$/, ""), token: String(token).trim().slice(0, 4096) };
}
