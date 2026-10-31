// Keep one UI for the installed extension and the local audio preview.
export async function createTransport() {
  if (globalThis.chrome?.runtime?.id) return {
    isExtension: true,
    send: (cmd, payload = {}) => chrome.runtime.sendMessage({ to: "bg", cmd, ...payload }),
    subscribe: listener => chrome.runtime.onMessage.addListener(message => {
      if (message.to === "ui") listener(message.state);
    }),
    getSelections: async () => (await chrome.storage.session.get("uiSelections")).uiSelections ?? [null, null],
    saveSelections: selections => chrome.storage.session.set({ uiSelections: selections }),
  };
  const { createPreviewTransport } = await import("../../demo/transport.js");
  return createPreviewTransport();
}
