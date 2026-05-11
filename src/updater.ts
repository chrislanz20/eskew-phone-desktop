// Silent autoupdater wired to GitHub Releases.
//
// Flow:
//   1. On launch (~10s after startup) + every 4 hours, check the
//      `chrislanz20/eskew-phone-desktop` GitHub Releases feed.
//   2. If a newer version is published, download in the background.
//   3. When the download finishes, show a small native notification:
//      "Eskew Phone updated — restart to apply." User can ignore;
//      next time they quit + relaunch, the new version is installed
//      automatically.
//
// No user interaction required other than eventually relaunching.

import { autoUpdater } from "electron-updater";
import { Notification, app } from "electron";

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours

let firstCheckScheduled = false;

export function initAutoUpdater(): void {
  // Don't run in dev — autoUpdater requires a packaged app.
  if (!app.isPackaged) {
    console.log("[updater] skipping autoupdater in dev mode");
    return;
  }

  // Silent — never show modal prompts. Just download and notify on completion.
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;

  autoUpdater.on("checking-for-update", () => {
    console.log("[updater] checking for update");
  });

  autoUpdater.on("update-available", (info) => {
    console.log(`[updater] update available: ${info.version}`);
  });

  autoUpdater.on("update-not-available", () => {
    console.log("[updater] up to date");
  });

  autoUpdater.on("download-progress", (progress) => {
    console.log(`[updater] downloading ${Math.round(progress.percent)}%`);
  });

  autoUpdater.on("update-downloaded", (info) => {
    console.log(`[updater] update downloaded: ${info.version}`);
    new Notification({
      title: "Eskew Phone updated",
      body: `Version ${info.version} ready — it will install when you next quit and relaunch.`,
      silent: true,
    }).show();
  });

  autoUpdater.on("error", (err) => {
    console.error("[updater] error:", err.message);
  });

  // First check shortly after startup so we don't compete with login + Twilio
  // Voice connection on a cold launch.
  if (!firstCheckScheduled) {
    firstCheckScheduled = true;
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch((e) => console.error("[updater] first check failed:", e));
    }, 10_000);
    setInterval(() => {
      autoUpdater.checkForUpdates().catch((e) => console.error("[updater] check failed:", e));
    }, CHECK_INTERVAL_MS);
  }
}
