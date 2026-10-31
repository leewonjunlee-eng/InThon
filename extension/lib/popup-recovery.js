// One attempt after a requested connection; never move the user's tab or window.
export async function reopenPopupAfterConnect(api, target) {
  try {
    const contexts = await api.runtime.getContexts({ contextTypes: ['POPUP'] });
    if (contexts.length) return false;
    const window = await api.windows.getLastFocused();
    if (!window.focused || window.id !== target.windowId) return false;
    const [active] = await api.tabs.query({ active: true, windowId: target.windowId });
    if (active?.id !== target.id) return false;
    await api.action.openPopup({ windowId: target.windowId });
    return true;
  } catch {
    // UI recovery must not turn a successful audio connection into an error.
    return false;
  }
}
