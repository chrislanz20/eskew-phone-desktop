// Run: npm run check:ring-focus   (compiles, then tests dist/incoming-call.js in plain node)
// Asserts what the desktop window does when a call rings, with and without the
// person's "Bring the phone app to the front when it rings" setting.
"use strict";
const assert = require("assert");
const { handleIncomingCall, shouldBringToFront } = require("../dist/incoming-call.js");

let n = 0;
function eq(actual, expected, label) { assert.deepStrictEqual(actual, expected, label); n++; }

function rig({ minimized = false, visible = true, notificationSupported = true } = {}) {
  const calls = [];
  const win = {
    isMinimized: () => minimized,
    restore: () => calls.push("restore"),
    isVisible: () => visible,
    show: () => calls.push("show"),
    focus: () => calls.push("focus"),
    flashFrame: (f) => calls.push(`flash:${f}`),
  };
  let notif = null;
  let clickHandler = null;
  const deps = {
    notificationSupported,
    createNotification: (o) => { notif = { ...o, shown: false }; return { on: (e, l) => { if (e === "click") clickHandler = l; }, show: () => { notif.shown = true; calls.push("notify"); } }; },
    showWindow: () => calls.push("showWindow"),
  };
  return { win, deps, calls, notif: () => notif, click: () => clickHandler && clickHandler() };
}

// ON (explicit true) — today's behaviour, every raise step in order
for (const info of [{ from: "+13175550100", bringToFront: true }, { from: "+13175550100" }, { from: "+13175550100", bringToFront: undefined }]) {
  const r = rig({ minimized: true, visible: false });
  const out = handleIncomingCall(r.win, info, r.deps);
  eq(out.raised, true, "ON raises");
  eq(r.calls, ["restore", "show", "focus", "flash:true", "notify"], "ON: restore, show, focus, flash, notify");
}

// ON does not restore a window that is not minimised, nor re-show a visible one
{ const r = rig(); handleIncomingCall(r.win, {}, r.deps); eq(r.calls, ["focus", "flash:true", "notify"], "ON on a normal window: focus + flash + notify"); }

// OFF — nothing is raised, everything else still happens
{
  const r = rig({ minimized: true, visible: false });
  const out = handleIncomingCall(r.win, { from: "+13175550100", callerName: "  Jane Doe ", bringToFront: false }, r.deps);
  eq(out.raised, false, "OFF does not raise");
  eq(r.calls, ["flash:true", "notify"], "OFF: only the attention flash and the notification");
  eq(r.notif().title, "Incoming call", "OFF: notification title");
  eq(r.notif().body, "Jane Doe", "OFF: notification names the caller");
  eq(r.notif().silent, true, "OFF: notification stays silent (the page plays the ring)");
  r.click();
  eq(r.calls[r.calls.length - 1], "showWindow", "OFF: clicking the notification brings the app up");
}
// OFF on a normal visible, unminimised window too (the "typing an email" case)
{ const r = rig(); handleIncomingCall(r.win, { bringToFront: false }, r.deps); eq(r.calls, ["flash:true", "notify"], "OFF visible window: no focus"); }
// ON: notification click also raises
{ const r = rig(); handleIncomingCall(r.win, {}, r.deps); r.click(); eq(r.calls[r.calls.length - 1], "showWindow", "ON: click raises"); }
// No notification support: OFF still flashes, never raises
{ const r = rig({ notificationSupported: false }); handleIncomingCall(r.win, { bringToFront: false }, r.deps); eq(r.calls, ["flash:true"], "OFF without notification support"); }

// Anything that is not a literal false is ON (unreadable / old page / garbage)
for (const v of [undefined, null, true, 0, "", "false", "off", 1, {}, []]) {
  eq(shouldBringToFront({ bringToFront: v }), true, `bringToFront ${JSON.stringify(v)} reads as ON`);
}
for (const bad of [undefined, null, "x", 5, true]) {
  const r = rig(); handleIncomingCall(r.win, bad, r.deps);
  eq(r.calls, ["focus", "flash:true", "notify"], `info ${JSON.stringify(bad)} reads as ON and does not throw`);
  eq(shouldBringToFront(bad), true, "non-object info is ON");
}
eq(shouldBringToFront({ bringToFront: false }), false, "only literal false is OFF");

console.log(`check-ring-focus: ${n} assertions passed`);
