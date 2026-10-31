export function savePreset(existing, profile) {
  if (!profile || typeof profile.id !== 'string' || !/^custom-[\w-]+$/.test(profile.id)) throw new Error('추천 프리셋은 복사해서 수정해 주세요.');
  const text = (value, limit) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
  const name = text(profile.name, 60), condition = text(profile.condition, 2000);
  if (!name || !condition) throw new Error('프리셋 이름과 알림 조건을 입력해 주세요.');
  const list = value => Array.isArray(value) ? value.filter(item => typeof item === 'string').map(item => text(item, 100)).filter(Boolean).slice(0, 30) : [];
  const saved = { id: profile.id, name, condition, summaryFocus: condition.slice(0, 300), keywords: list(profile.keywords), relatedSites: list(profile.relatedSites), relatedWords: list(profile.relatedWords), aliases: profile.aliases && typeof profile.aliases === 'object' ? profile.aliases : {} };
  return [...existing.filter(item => item.id !== saved.id), saved];
}
export function deletePreset(existing, slots, id) {
  if (!existing.some(item => item.id === id) || !id.startsWith('custom-')) throw new Error('내 프리셋만 삭제할 수 있어요.');
  for (const slot of slots) if (slot.profileId === id) slot.profileId = null;
  return existing.filter(item => item.id !== id);
}

// Normalize generated lists without adding a second number on repeated edits.
export function numberConditions(value) {
  return String(value ?? "").split(/\r?\n/).map(line => line.trim().replace(/^(?:\d+[.)]\s*|[-*•]\s+)/, "")).filter(Boolean)
    .map((line, index) => `${index + 1}. ${line}`).join("\n");
}
