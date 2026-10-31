// A live tutorial owns shortcuts until its popup closes or the tour exits.
export const TUTORIAL_PORT = 'catchsound-tutorial';
export function createTutorialShortcutRouter(runtime) {
  const ports = new Set();
  runtime.onConnect?.addListener(port => {
    if (port.name !== TUTORIAL_PORT) return;
    ports.add(port);
    port.onDisconnect.addListener(() => ports.delete(port));
    // Messages keep this connection live while the tutorial is visible.
    port.onMessage.addListener(() => {});
  });
  return command => {
    if (!ports.size) return false;
    const port = [...ports].at(-1);
    try { port.postMessage({ command }); } catch { ports.delete(port); }
    // Never fall through to real audio on a failed tutorial delivery.
    return true;
  };
}
export function connectTutorialShortcuts(runtime, onCommand) {
  if (!runtime?.id || !runtime.connect) return () => {};
  let port, stopped = false, retry;
  function connect() {
    if (stopped) return;
    port = runtime.connect({ name: TUTORIAL_PORT });
    port.onMessage.addListener(message => onCommand(message.command));
    port.onDisconnect.addListener(() => {
      void runtime.lastError;
      if (!stopped) retry = setTimeout(connect, 100);
    });
  }
  connect();
  const heartbeat = setInterval(() => {
    try { port?.postMessage({ alive: true }); } catch {}
  }, 20000);
  return () => {
    stopped = true;
    clearTimeout(retry);
    clearInterval(heartbeat);
    port?.disconnect();
  };
}
