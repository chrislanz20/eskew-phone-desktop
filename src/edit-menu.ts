import { BrowserWindow, Menu, MenuItemConstructorOptions, clipboard, shell } from "electron";

// ---------------------------------------------------------------------------
// Cut / Copy / Paste
//
// Electron gives a wrapper app NEITHER of the two things a Windows user
// reaches for when they want to paste:
//
//   1. There is no default right-click context menu. Right-clicking a text
//      field in a stock Electron window shows nothing at all — no Paste, no
//      Copy, no Select All. A browser tab has one; an Electron window does
//      not, and the difference is invisible to the person using it.
//   2. The default application menu (which is what carries the Ctrl+V /
//      Cmd+V accelerators) is easy to lose the moment anything else touches
//      the menu, and this app also runs with `autoHideMenuBar: true`, so
//      even when it exists there is no visible Edit menu to fall back on.
//
// Staff reported "it won't let me copy and paste" — including pasting a
// password into the login field, which is the one place a person is most
// likely to be pasting rather than typing. Nothing in the web app blocks it;
// the wrapper simply never offered the affordance.
//
// So we do both explicitly: a real context menu on every right-click, and an
// application menu that pins the standard edit roles (and therefore their
// accelerators) rather than relying on Electron's default surviving.
// ---------------------------------------------------------------------------

/**
 * Install the application menu.
 *
 * The window keeps `autoHideMenuBar: true`, so on Windows/Linux this changes
 * nothing visually (Alt still reveals it) — its job is to guarantee the
 * Ctrl+V / Ctrl+C / Ctrl+X / Ctrl+A accelerators are bound. On macOS it also
 * restores the standard app menu, which is where Cmd+Q and Cmd+V live.
 */
export function installApplicationMenu(appName: string): void {
  const isMac = process.platform === "darwin";

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([
          {
            label: appName,
            submenu: [
              { role: "about" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ] as MenuItemConstructorOptions[])
      : []),
    {
      label: "&File",
      submenu: [isMac ? { role: "close" } : { role: "quit" }],
    },
    {
      label: "&Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        // Pasting into a plain <input> should not carry styling from wherever
        // the text was copied (Outlook, Word). The web app's fields are plain
        // text, so this is belt-and-braces, but it costs nothing and it is
        // what a user expects from "Paste".
        { role: "pasteAndMatchStyle" },
        { role: "delete" },
        { type: "separator" },
        { role: "selectAll" },
      ],
    },
    {
      label: "&View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "&Window",
      submenu: isMac
        ? [{ role: "minimize" }, { role: "zoom" }, { type: "separator" }, { role: "front" }]
        : [{ role: "minimize" }],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}


/**
 * Read the text of the block under the cursor, for "Copy Text".
 *
 * Runs in the page because the main process has no DOM. Walks up at most four
 * ancestors from the clicked point and takes the first one carrying real text,
 * so a click anywhere on a message bubble copies that message and a click on
 * empty space copies nothing. The 2000-character ceiling is the backstop: if
 * the walk ever escapes into a scroll container, we return nothing rather than
 * silently putting an entire conversation on the clipboard.
 *
 * Any failure resolves to null and the item is simply not offered.
 */
async function readTextUnderCursor(win: BrowserWindow, x: number, y: number): Promise<string | null> {
  const js = `(() => {
    try {
      var el = document.elementFromPoint(${Number(x)}, ${Number(y)});
      for (var i = 0; el && i < 4; i++, el = el.parentElement) {
        var t = (el.innerText || "").trim();
        if (t.length > 0 && t.length <= 2000) return t;
        if (t.length > 2000) return null;
      }
      return null;
    } catch (e) { return null; }
  })()`;
  // HARD TIMEOUT. The menu is popped AFTER this resolves, so a renderer that
  // is wedged (the exact state the black-screen watchdog exists for) must not
  // be able to stop the right-click menu from appearing at all — that would be
  // strictly worse than the bug being fixed. Lose the Copy Text item, keep the
  // menu.
  const timeout = new Promise<null>(resolve => setTimeout(() => resolve(null), 150));
  try {
    const result = await Promise.race([win.webContents.executeJavaScript(js, true), timeout]);
    return typeof result === "string" && result.trim().length > 0 ? result : null;
  } catch {
    return null;
  }
}

/**
 * Attach a right-click context menu to a window's web contents.
 *
 * Items are enabled off Chromium's own `editFlags` for the element that was
 * clicked, so Paste is greyed out in a non-editable spot instead of silently
 * doing nothing — the failure mode we are fixing is precisely a control that
 * looks available and isn't.
 *
 * Re-attaching on navigation is unnecessary: `context-menu` is a webContents
 * event and survives every in-app navigation and reload.
 */
export function attachContextMenu(win: BrowserWindow): void {
  win.webContents.on("context-menu", async (_event, params) => {
    const flags = params.editFlags;
    const hasSelection = params.selectionText.trim().length > 0;
    const items: MenuItemConstructorOptions[] = [];

    // Spelling suggestions first, the way every native text field orders them.
    if (params.isEditable && params.misspelledWord && params.dictionarySuggestions.length > 0) {
      for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
        items.push({
          label: suggestion,
          click: () => win.webContents.replaceMisspelling(suggestion),
        });
      }
      items.push({ type: "separator" });
    }

    if (params.isEditable) {
      // Inside a text box the four standard roles all mean what they say, and
      // "Select All" is scoped to that box.
      items.push(
        { label: "Cut", role: "cut", enabled: flags.canCut },
        { label: "Copy", role: "copy", enabled: flags.canCopy },
        { label: "Paste", role: "paste", enabled: flags.canPaste },
        { label: "Select All", role: "selectAll", enabled: flags.canSelectAll },
      );
    } else {
      // NOT A TEXT BOX. This is the case that used to produce NO MENU AT ALL
      // whenever nothing happened to be selected, so the app looked like it
      // had no copy function; staff reported exactly that.
      //
      // 🔴 IT IS A PLATFORM SPLIT, WHICH IS WHY IT LOOKED FINE ON A MAC.
      // Chromium on macOS selects the word under the cursor on right-click,
      // so `hasSelection` was true and a Copy item appeared. Windows does not
      // auto-select, so the same right-click fell through and drew nothing.
      // Measured on macOS: a synthetic right-click on a message reported
      // selectionText "protection" without anyone selecting it.
      //
      // Both platforms now get the same two items, so the menu no longer
      // depends on a selection appearing by accident.
      if (hasSelection) {
        items.push({ label: "Copy", role: "copy", enabled: flags.canCopy });
      }

      // Copy the whole block under the cursor — one message, not one word.
      // Resolved in the renderer (the main process has no DOM) by walking UP
      // from the clicked point, capped at four levels and 2000 characters so a
      // click on a gap can never hand over the entire conversation.
      // Deliberately generic: no app class names, so it survives markup
      // changes. Only pushed when there IS text — a greyed-out Copy teaches
      // the same wrong lesson as no menu at all.
      const blockText = await readTextUnderCursor(win, params.x, params.y);
      if (blockText && blockText !== params.selectionText.trim()) {
        items.push({
          label: hasSelection ? "Copy Whole Message" : "Copy Text",
          click: () => clipboard.writeText(blockText),
        });
      }
    }

    // Right-clicking a link should offer to copy it — staff share recording
    // and share links out of this app constantly.
    if (params.linkURL) {
      if (items.length > 0) items.push({ type: "separator" });
      items.push(
        {
          label: "Copy Link",
          click: () => clipboard.writeText(params.linkURL),
        },
        {
          label: "Open Link in Browser",
          click: () => {
            if (params.linkURL.startsWith("http://") || params.linkURL.startsWith("https://")) {
              shell.openExternal(params.linkURL);
            }
          },
        },
      );
    }

    if (items.length === 0) return;

    Menu.buildFromTemplate(items).popup({ window: win });
  });
}
