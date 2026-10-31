export function normalizeConnection({ serverUrl, token = "" }) {
  let url;
  try { url = new URL(String(serverUrl).trim()); }
  catch { throw new Error("AI 서버 주소를 http:// 또는 https://로 입력해 주세요."); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("서버 주소에는 http(s) 주소만 입력해 주세요. 인증 정보나 쿼리는 넣지 마세요.");
  }
  return { serverUrl: url.href.replace(/\/+$/, ""), token: String(token).trim().slice(0, 4096) };
}

// A new shared package must replace a saved localhost/old-token connection once.
// Its fingerprint then lets subsequent manual server choices remain intact.
export async function applyBundledConnection(settings, bundle, force = false) {
  if (!bundle?.token) return settings;
  const connection = normalizeConnection(bundle);
  const bytes = new TextEncoder().encode(connection.serverUrl + "\n" + connection.token);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const id = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
  if (!force && settings.connectionBundleId === id) return settings;
  return { ...settings, ...connection, connectionBundleId: id };
}
