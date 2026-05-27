import { app } from "electron";
import * as fs from "fs";
import * as path from "path";

// A black/blank screen that survives a restart is almost always corrupted
// on-disk Chromium cache — the GPU shader cache or the V8 code cache. These
// dirs are safe to delete while the app is NOT running; Chromium regenerates
// them on the next launch. Deleting them does NOT touch cookies / localStorage
// / IndexedDB, so the staffer stays logged into Twilio + the dashboard.
const CACHE_DIR_NAMES = new Set([
  "GPUCache",
  "Code Cache",
  "DawnCache",
  "DawnGraphiteCache",
  "ShaderCache",
  "GrShaderCache",
]);

// Touch-file that marks "a session is currently running." Present at the next
// launch => the previous session did not exit cleanly (crash, force-kill, or
// our own recovery relaunch) => proactively wipe the GPU/shader caches.
function runningFlagPath(): string {
  return path.join(app.getPath("userData"), ".session-running");
}

function rmDirSafe(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}

// Recursively delete any cache dir (by name) under `root`, including the ones
// nested in Partitions/<name>/. Walks top-down and skips descending into a dir
// it just deleted. Returns how many were removed.
function wipeCacheDirs(root: string): number {
  let removed = 0;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const full = path.join(root, entry.name);
    if (CACHE_DIR_NAMES.has(entry.name)) {
      rmDirSafe(full);
      removed++;
    } else {
      removed += wipeCacheDirs(full);
    }
  }
  return removed;
}

// Run once at startup, BEFORE the BrowserWindow is created (nothing is using
// the cache files yet). If the previous session left the running-flag behind,
// it crashed or was force-killed — the usual cause of a recurring black
// screen — so wipe the GPU/shader caches to force a clean recompile. Always
// (re)writes the flag for this session.
export function reconcileStartup(): void {
  const flag = runningFlagPath();
  try {
    if (fs.existsSync(flag)) {
      const removed = wipeCacheDirs(app.getPath("userData"));
      console.warn(
        `[recovery] previous session ended uncleanly — wiped ${removed} cache dir(s)`
      );
    }
  } catch (err) {
    console.error("[recovery] reconcileStartup failed", err);
  }
  try {
    fs.writeFileSync(flag, new Date().toISOString());
  } catch {
    /* best effort */
  }
}

// Called on a clean quit (tray Quit / Cmd+Q / OS shutdown). Removing the flag
// tells the next launch the shutdown was clean, so it skips the cache wipe.
export function markCleanShutdown(): void {
  try {
    fs.rmSync(runningFlagPath(), { force: true });
  } catch {
    /* best effort */
  }
}

// Restart the app while LEAVING the running-flag in place, so the next launch's
// reconcileStartup() wipes the GPU/shader caches before recreating the window.
// app.exit() (not app.quit()) skips before-quit, so markCleanShutdown never
// runs and the flag survives into the next process.
export function relaunchWithCacheWipe(): void {
  console.warn("[recovery] relaunching with cache wipe on next boot");
  app.relaunch();
  app.exit(0);
}
