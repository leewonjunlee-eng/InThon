// Preserve index-based focus when a slot is removed; snapshots no longer match.
export function removeSlot(state, index) {
  if (!Number.isInteger(index) || !state.slots[index]) throw new Error("삭제할 탭이 없습니다.");
  const [slot] = state.slots.splice(index, 1);
  const shift = value => value === index ? null : value > index ? value - 1 : value;
  state.manual = shift(state.manual);
  state.peek = shift(state.peek);
  state.snapshot = null;
  if (state.returnSummary) {
    const next = shift(state.returnSummary.slot);
    if (next === null) state.returnSummary = null;
    else state.returnSummary.slot = next;
  }
  if (state.transcript) state.transcript = state.transcript.filter(line => line.tabId !== slot.tabId);
  return slot;
}
