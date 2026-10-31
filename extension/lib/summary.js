// A fallback is an excerpt of recognized speech, never a fabricated AI summary.
export function transcriptExcerpt(lines) {
  const evidence = [...new Set(lines.map(line => line.text.trim()).filter(text => text && !text.startsWith("(")))].slice(-3);
  return {
    summary: evidence.length ? evidence.join("\n") : "소리 변화가 감지됐지만 인식된 자막이 없어 내용을 확인할 수 없습니다.",
    evidence,
  };
}

export function normalizeSummary(result, lines) {
  if (typeof result?.summary !== "string" || !result.summary.trim()) throw new Error("empty summary");
  const source = lines.map(line => line.text).join("\n");
  const evidence = Array.isArray(result.evidence)
    ? result.evidence.filter(item => typeof item === "string" && item.trim() && source.includes(item.trim())).map(item => item.trim()).slice(0, 3)
    : [];
  return { summary: result.summary.trim(), evidence: evidence.length ? evidence : transcriptExcerpt(lines).evidence };
}
