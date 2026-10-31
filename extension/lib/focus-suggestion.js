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
    current.timer = schedule(async () => {
      if (visit !== current || read()?.tabId !== current.tabId) return;
      await show(current).catch(() => {});
      if (visit !== current || read()?.tabId !== current.tabId) await clear(current.tabId);
    }, 3000);
  }
  return { update };
}
