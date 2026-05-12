import { contextBridge, ipcRenderer } from "electron";

// Surface a minimal, typed API to the renderer (eskewphone.info).
// Web code calls `window.eskewDesktop?.setBadge(n)` — guarded by optional chaining
// so the same web bundle still works in the regular browser.
contextBridge.exposeInMainWorld("eskewDesktop", {
  setBadge: (count: number) => ipcRenderer.send("eskew:set-badge", count),
});
