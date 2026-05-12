import {
  app,
  BrowserWindow,
  ipcMain,
  nativeImage,
  Notification,
  powerMonitor,
  session,
  shell,
} from "electron";
import * as path from "path";
import { createTray, updateTrayMenu } from "./tray";
import { initAutoUpdater } from "./updater";

// Prevent the OS from throttling background renderers when the window is hidden.
// Twilio Voice WebSocket / Notification timers must keep running in the tray.
app.commandLine.appendSwitch(
  "disable-features",
  "CalculateNativeWinOcclusion,IntensiveWakeUpThrottling"
);
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");

// Allow the renderer to use the microphone without an extra OS prompt loop.
app.commandLine.appendSwitch("enable-features", "WebRTC");

const APP_URL = "https://eskewphone.info";
const SINGLE_INSTANCE = app.requestSingleInstanceLock();

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;

if (!SINGLE_INSTANCE) {
  app.quit();
} else {
  app.on("second-instance", () => {
    showWindow();
  });
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: "Eskew Phone",
    backgroundColor: "#0b1220",
    show: false,
    autoHideMenuBar: true,
    // Embed the macOS traffic lights INSIDE the app's top bar so we get back
    // the ~28px strip that the default title bar otherwise takes. The web
    // app's purple header has plenty of padding for the lights to sit cleanly
    // in the top-left.
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Persist Twilio Voice + login session across launches.
      partition: "persist:eskewphone",
      backgroundThrottling: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  // Auto-grant mic / notifications / media for eskewphone.info — Twilio Voice
  // browser SDK needs these on every load and we don't want a prompt to break
  // a ringing call.
  const ses = win.webContents.session;
  ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
    const url = details?.requestingUrl ?? "";
    const allowedHosts = ["eskewphone.info"];
    const allowed = allowedHosts.some((h) => url.includes(h));
    const granted =
      allowed &&
      [
        "media",
        "audioCapture",
        "videoCapture",
        "notifications",
        "background-sync",
        "clipboard-read",
        "clipboard-sanitized-write",
        "display-capture",
      ].includes(permission);
    callback(granted);
  });

  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
    if (!requestingOrigin) return false;
    if (!requestingOrigin.includes("eskewphone.info")) return false;
    return [
      "media",
      "audioCapture",
      "videoCapture",
      "notifications",
      "background-sync",
      "clipboard-read",
      "clipboard-sanitized-write",
    ].includes(permission);
  });

  // Set a desktop user-agent suffix so the Next.js app can detect the
  // wrapper if it ever needs to (e.g. to hide the iOS-app banner).
  const ua = win.webContents.getUserAgent() + " EskewPhoneDesktop/1.0.0";
  win.webContents.setUserAgent(ua);

  win.loadURL(APP_URL);

  win.once("ready-to-show", () => {
    win.show();
  });

  // Inject a CSS rule that makes the app's top bar draggable. The web app
  // has a sticky brand-colored header at the top of every dashboard page —
  // without `-webkit-app-region: drag` macOS doesn't know that strip is meant
  // to act as a window titlebar, so the entire window is stuck where it
  // opened. Buttons and inputs inside that strip stay clickable via
  // `no-drag`. Injected on every page load (login + dashboard).
  const DRAG_CSS = `
    /* Top sticky brand header in the dashboard layout */
    .dashboard-shell > header,
    header.bg-brand,
    nav.bg-brand,
    [data-electron-drag] {
      -webkit-app-region: drag;
    }
    /* Keep every interactive element inside the drag region clickable */
    button, a, input, select, textarea,
    [role="button"], [role="link"], [role="menuitem"],
    [contenteditable="true"], .no-drag, [data-electron-no-drag] {
      -webkit-app-region: no-drag;
    }
    /* A 28px transparent strip across the very top is ALWAYS draggable so
       the user can grab the window from above the traffic lights even if
       the app's header layout changes. Sits behind everything else so it
       doesn't block clicks on real content. */
    body::before {
      content: "";
      position: fixed;
      top: 0; left: 0; right: 0;
      height: 28px;
      -webkit-app-region: drag;
      pointer-events: none;
      z-index: 9999;
    }
  `;
  win.webContents.on("did-finish-load", () => {
    win.webContents.insertCSS(DRAG_CSS).catch(() => undefined);
  });
  win.webContents.on("did-navigate-in-page", () => {
    win.webContents.insertCSS(DRAG_CSS).catch(() => undefined);
  });

  // Open external links in the default browser instead of new Electron windows.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      const u = new URL(url);
      if (u.hostname !== "eskewphone.info") {
        shell.openExternal(url);
        return { action: "deny" };
      }
    }
    return { action: "allow" };
  });

  // Hide instead of quit when the user closes the window — keep WebSocket
  // alive in the tray so calls still ring.
  win.on("close", (e) => {
    if (!isQuitting) {
      e.preventDefault();
      win.hide();
      if (process.platform === "darwin") {
        // Hide from the Dock so it really feels backgrounded.
        // Comment this out if Chris wants the Dock icon to remain.
        app.dock?.hide();
      }
      updateTrayMenu(getMainWindow());
    }
  });

  win.on("show", () => {
    if (process.platform === "darwin") {
      app.dock?.show();
    }
    updateTrayMenu(getMainWindow());
  });

  win.on("hide", () => {
    updateTrayMenu(getMainWindow());
  });

  // Surface unhandled load failures (e.g. offline) as notifications so staff
  // notice the app needs a manual reload.
  win.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL) => {
      if (errorCode === -3) return; // ABORTED, common during navigation
      console.error(
        `[main] did-fail-load ${errorCode} ${errorDescription} ${validatedURL}`
      );
      try {
        new Notification({
          title: "Eskew Phone — connection lost",
          body: `Couldn't load ${validatedURL}. Click the tray icon to reload.`,
        }).show();
      } catch {
        /* ignore */
      }
    }
  );

  return win;
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export function showWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createMainWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

export function hideWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide();
  }
}

export function quitApp(): void {
  isQuitting = true;
  app.quit();
}

app.whenReady().then(() => {
  // Ensure permissions on the persistent partition before the window loads.
  const persistent = session.fromPartition("persist:eskewphone");
  persistent.setPermissionRequestHandler((_wc, permission, callback) => {
    const granted = [
      "media",
      "audioCapture",
      "videoCapture",
      "notifications",
      "background-sync",
      "clipboard-read",
      "clipboard-sanitized-write",
      "display-capture",
    ].includes(permission);
    callback(granted);
  });

  mainWindow = createMainWindow();
  createTray({
    onShow: showWindow,
    onHide: hideWindow,
    onQuit: quitApp,
    onReload: () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.reload();
      }
    },
    getWindow: getMainWindow,
  });

  // Wire silent autoupdater (GitHub Releases). First check fires 10s after
  // launch so it doesn't compete with login + Twilio Voice on cold start.
  initAutoUpdater();

  // Unread badge — dock badge on Mac (with count), taskbar dot on Windows.
  // Web app pushes the total unread count whenever it changes; 0 clears.
  ipcMain.on("eskew:set-badge", (_event, count: number) => {
    const n = Math.max(0, Math.floor(Number(count) || 0));
    if (process.platform === "darwin") {
      app.dock?.setBadge(n > 0 ? String(n) : "");
    } else if (process.platform === "win32" && mainWindow && !mainWindow.isDestroyed()) {
      // Windows taskbar overlay: 16x16 red dot if any unread, else clear.
      // Using a tiny in-memory PNG so we don't need a bundled asset.
      if (n > 0) {
        const red = nativeImage.createFromBuffer(Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAQAAAC1+jfqAAAAaklEQVR42mNgGAWj" +
          "YBSMglEwCkbBKBgFowAEGGEC/4HoPwj/B7H/MzAwsDIwMDIwMDAyMDAxMDAxAEUYG" +
          "BgYGRgYGBnYgIwGBgYWBgZGBgYGRgYGBgYGRgYGFgYGRgYGBgYGFgYGBgYGAJwsB" +
          "5pBKv6sAAAAASUVORK5CYII=",
          "base64"
        ));
        mainWindow.setOverlayIcon(red, `${n} unread`);
      } else {
        mainWindow.setOverlayIcon(null, "");
      }
    }
  });

  // Reload the web app on wake — Twilio Voice WebSocket usually drops during
  // sleep and the Next.js app's auto-reconnect is unreliable.
  powerMonitor.on("resume", () => {
    console.log("[main] system resumed — reloading window");
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.reloadIgnoringCache();
    }
  });

  powerMonitor.on("unlock-screen", () => {
    console.log("[main] screen unlocked");
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      // Don't auto-show, but make sure the page is fresh for the next call.
      mainWindow.webContents
        .executeJavaScript(
          "(typeof document !== 'undefined' && document.hasFocus && document.hasFocus()) || false"
        )
        .catch(() => undefined);
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
    } else {
      showWindow();
    }
  });
});

app.on("before-quit", () => {
  isQuitting = true;
});

// Don't quit on macOS when all windows are closed — the tray keeps us alive.
// We never call app.quit() here, which keeps the Electron event loop running
// (Electron only exits when the last window closes AND no quit was requested).
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
  // On darwin: do nothing — tray menu's Quit handler is the only way out.
});
