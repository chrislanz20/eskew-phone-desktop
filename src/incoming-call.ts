// What the desktop app does with its window when a call rings.
//
// Kept apart from main.ts (which needs Electron) so the rule can be tested in
// plain node. main.ts passes in the real window, the real Notification class
// and its own showWindow.
//
// THE RULE: a person can turn off "Bring the phone app to the front when it
// rings" in Settings. The web page sends that choice with every ring as
// `bringToFront`. Only a literal `false` means OFF. Anything else (no field,
// an older web page, a bad value, no info at all) means ON, which is how the
// app has always behaved: a missed call is worse than an interruption.
//
// OFF changes ONE thing: the window is not restored, shown, or focused. The
// taskbar/dock attention flash, the notification (click brings the app up) and
// the in-app incoming-call screen are all exactly as before. The ring sound is
// played by the web page itself.

export interface IncomingCallInfo {
  from?: string;
  callerName?: string;
  bringToFront?: boolean;
}

export interface RingWindow {
  isMinimized(): boolean;
  restore(): void;
  isVisible(): boolean;
  show(): void;
  focus(): void;
  flashFrame(flag: boolean): void;
}

export interface RingNotification {
  on(event: "click", listener: () => void): unknown;
  show(): void;
}

export interface RingDeps {
  notificationSupported: boolean;
  createNotification(options: { title: string; body: string; silent: boolean }): RingNotification;
  /** The app's normal "bring the window up" (restore + show + focus). */
  showWindow(): void;
}

/** ON unless the page said, in so many words, `bringToFront: false`. */
export function shouldBringToFront(info: unknown): boolean {
  if (!info || typeof info !== "object") return true;
  return (info as IncomingCallInfo).bringToFront !== false;
}

export function handleIncomingCall(win: RingWindow, rawInfo: unknown, deps: RingDeps): { raised: boolean } {
  const info: IncomingCallInfo = rawInfo && typeof rawInfo === "object" ? (rawInfo as IncomingCallInfo) : {};
  const raise = shouldBringToFront(info);

  // Bring the window into view. On Windows the OS may decline to steal
  // foreground focus from whatever the user is actively in — flashFrame +
  // the notification below are the reliable attention signals in that case.
  if (raise) {
    if (win.isMinimized()) win.restore();
    if (!win.isVisible()) win.show();
    win.focus();
  }
  // Attention flash (taskbar on Windows, Dock bounce on macOS). Never takes focus.
  win.flashFrame(true);

  if (deps.notificationSupported) {
    const who =
      info.callerName?.trim() ||
      (info.from && info.from !== "Unknown" ? info.from : "Unknown caller");
    const notif = deps.createNotification({ title: "Incoming call", body: who, silent: true });
    notif.on("click", () => deps.showWindow());
    notif.show();
  }
  return { raised: raise };
}
