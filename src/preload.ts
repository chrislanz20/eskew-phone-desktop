import { contextBridge, ipcRenderer } from "electron";

// Surface a minimal, typed API to the renderer (eskewphone.info).
// Web code calls `window.eskewDesktop?.setBadge(n)` — guarded by optional chaining
// so the same web bundle still works in the regular browser.
// retryConnect / quit are used by the bundled connection-error.html page.
contextBridge.exposeInMainWorld("eskewDesktop", {
  setBadge: (count: number) => ipcRenderer.send("eskew:set-badge", count),
  // Fired on Twilio Device 'incoming' so the main process can surface the
  // window, flash the taskbar, and pop a notification even when minimized/hidden.
  incomingCall: (info: { from?: string; callerName?: string }) =>
    ipcRenderer.send("eskew:incoming-call", info),
  // Fired when the call is answered, rejected, or cancelled — stops the flash.
  callEnded: () => ipcRenderer.send("eskew:call-ended"),
  // True while a Twilio call is ringing or connected, false when it's over.
  // The web app re-sends true every ~30s as a heartbeat. Lets the main
  // process hold its softer recovery actions (wake reloads, black-screen
  // reloads) instead of killing a live call — the recovery ladder was built
  // call-unaware. NOT the same as callEnded above, which only means "ringing
  // stopped" and fires even when the call was just answered.
  setCallActive: (active: boolean) => ipcRenderer.send("eskew:call-active", active),
  retryConnect: () => ipcRenderer.send("eskew:retry-connect"),
  resetReload: () => ipcRenderer.send("eskew:reset-reload"),
  quit: () => ipcRenderer.send("eskew:quit"),
});
