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
  retryConnect: () => ipcRenderer.send("eskew:retry-connect"),
  resetReload: () => ipcRenderer.send("eskew:reset-reload"),
  quit: () => ipcRenderer.send("eskew:quit"),
});
