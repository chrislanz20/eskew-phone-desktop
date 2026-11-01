// "Call" links from the case app (Eskew OS): eskewphone://dial?number=<digits>&name=<text>
//
// Nov 1 2026: staff click Call in the case app and THIS desktop app should come
// to the front with its usual "Call <name>? (number)" confirm — no browser tab.
// The OS hands us the link (macOS open-url, Windows command line); this file
// decides whether it is one we act on and, if so, which page of OUR OWN app to
// show. It never dials: the web app's /calls?dial= reader (eskew-phone-system
// lib/dial-link.ts) re-checks the number with its strict rules and only ever
// OFFERS it through the confirm box.
//
// Strict on purpose — anything on a web page can fire an eskewphone:// link:
//  - scheme eskewphone:, the "dial" action and nothing else (no user, password,
//    port or extra path)
//  - exactly one `number`: an optional "+" then 7–18 digits, nothing else
//  - `name` is display-only: control/format characters removed, whitespace
//    collapsed, cut to 80 characters (the web app cuts again, at 60)
//  - every other parameter is dropped; the target address is ALWAYS built
//    from the app's own base URL, never from anything in the link
//
// No Electron import here so `npm run check:dial-link` can test it in plain node.

export const DIAL_SCHEME = "eskewphone";
const MAX_LINK_CHARS = 1024;
const MAX_NAME_CHARS = 80;
const NUMBER_RE = /^\+?\d{7,18}$/;

export type DialRequest = { number: string; name?: string };

function cleanName(raw: string | null): string | undefined {
  if (raw === null) return undefined;
  let s = raw.replace(
    /[\u0000-\u001f\u007f-\u009f؜᠎​-‏‪-‮⁠-⁩﻿]/g,
    " "
  );
  s = s.replace(/\s+/g, " ").trim();
  if (!s) return undefined;
  const chars = Array.from(s);
  if (chars.length > MAX_NAME_CHARS) s = chars.slice(0, MAX_NAME_CHARS).join("").trim();
  return s || undefined;
}

/** eskewphone://dial?number=…&name=… → { number, name? }, or null for anything else. */
export function parseDialLink(raw: unknown): DialRequest | null {
  if (typeof raw !== "string") return null;
  const link = raw.trim();
  if (!link || link.length > MAX_LINK_CHARS) return null;
  let u: URL;
  try {
    u = new URL(link);
  } catch {
    return null;
  }
  if (u.protocol.toLowerCase() !== `${DIAL_SCHEME}:`) return null;
  if (u.username || u.password || u.port) return null;
  // eskewphone://dial?…  (also tolerate a trailing slash: eskewphone://dial/?…)
  if (u.hostname.toLowerCase() !== "dial") return null;
  if (u.pathname !== "" && u.pathname !== "/") return null;

  const numbers = u.searchParams.getAll("number");
  if (numbers.length !== 1) return null;
  // No trim: a "+" sent unencoded arrives as a space, and " 4420…" must not
  // quietly become a different (domestic-looking) number.
  const number = numbers[0];
  if (!NUMBER_RE.test(number)) return null;

  const names = u.searchParams.getAll("name");
  if (names.length > 1) return null;
  const name = cleanName(names.length ? names[0] : null);
  return name ? { number, name } : { number };
}

/** The first eskewphone: link on a command line (Windows hands it to us as an argument). */
export function dialLinkFromArgv(argv: readonly string[]): string | null {
  for (const arg of argv) {
    if (typeof arg === "string" && arg.toLowerCase().startsWith(`${DIAL_SCHEME}:`)) return arg;
  }
  return null;
}

/** The page of our own app that offers the number: <base>/calls?dial=<number>&name=<name>. */
export function dialPageUrl(baseUrl: string, req: DialRequest): string {
  const q = new URLSearchParams({ dial: req.number });
  if (req.name) q.set("name", req.name);
  return `${baseUrl.replace(/\/+$/, "")}/calls?${q.toString()}`;
}
