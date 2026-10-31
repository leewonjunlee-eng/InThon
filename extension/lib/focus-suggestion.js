// One suggestion per continuous visit, never an automatic focus change.
export function createFocusSuggestion({ read, show, clear, schedule = setTimeout, cancel = clearTimeout }) {
  let visit = null;
  function update() {
    const candidate = read();
    if (candidate?.tabId === visit?.tabId) return;
    if (visit) { cancel(visit.timer); void clear(visit.tabId); }
    visit = candidate ? { ...candidate } : null;
    if (!visit) return;
    const current = visit;
    const attempt = async () => {
      if (visit !== current || read()?.tabId !== current.tabId) return;
      try { await show(current); }
      catch {
        current.failures = (current.failures ?? 0) + 1;
        if (visit === current && read()?.tabId === current.tabId && current.failures < 3) {
          current.timer = schedule(attempt, 3000);
        }
        return;
      }
      if (visit !== current || read()?.tabId !== current.tabId) await clear(current.tabId);
    };
    current.timer = schedule(attempt, 3000);
  }
  return { update };
}
