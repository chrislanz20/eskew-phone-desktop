import { contextBridge, ipcRenderer } from "electron";

// Surface a minimal, typed API to the renderer (eskewphone.info).
// Web code calls `window.eskewDesktop?.setBadge(n)` — guarded by optional chaining
// so the same web bundle still works in the regular browser.
// retryConnect / quit are used by the bundled connection-error.html page.
contextBridge.exposeInMainWorld("eskewDesktop", {
  setBadge: (count: number) => ipcRenderer.send("eskew:set-badge", count),
  retryConnect: () => ipcRenderer.send("eskew:retry-connect"),
  quit: () => ipcRenderer.send("eskew:quit"),
});
