// Run: npm run check:dial-link   (compiles, then tests dist/dial-link.js in plain node)
// Asserts the eskewphone://dial parser accepts only real dial links and that
// the page it opens is always built from the app's own address.
"use strict";
const assert = require("assert");
const { parseDialLink, dialLinkFromArgv, dialPageUrl, normalizeDialNumber } = require("../dist/dial-link.js");

const BASE = "https://eskewphone.info";
let n = 0;
function eq(actual, expected, label) {
  assert.deepStrictEqual(actual, expected, label);
  n++;
}

// Accepted
eq(parseDialLink("eskewphone://dial?number=8565195011"), { number: "+18565195011" }, "bare 10 digits → E.164");
eq(parseDialLink("eskewphone://dial?number=8565195011&name=Jane%20Doe"), { number: "+18565195011", name: "Jane Doe" }, "with name");
eq(parseDialLink("eskewphone://dial?number=%2B442071234567&name=A"), { number: "+442071234567", name: "A" }, "encoded +");
eq(parseDialLink("eskewphone://dial/?number=8565195011"), { number: "+18565195011" }, "trailing slash");
eq(parseDialLink("ESKEWPHONE://DIAL?number=8565195011"), { number: "+18565195011" }, "case-insensitive scheme/action");
eq(parseDialLink("eskewphone://dial?number=8565195011&name=Jane+Doe"), { number: "+18565195011", name: "Jane Doe" }, "form-encoded space in name");
eq(parseDialLink("eskewphone://dial?number=8565195011&name=%20%20"), { number: "+18565195011" }, "blank name dropped");
eq(parseDialLink("eskewphone://dial?number=8565195011&name=a%0Ab%E2%80%AEc"), { number: "+18565195011", name: "a b c" }, "control + bidi chars removed");
eq(parseDialLink("eskewphone://dial?number=8565195011&name=" + "x".repeat(200)).name.length, 60, "name capped at 60 (web app rule)");
eq(parseDialLink("eskewphone://dial?number=8565195011&utm=1&url=https://evil.example"), { number: "+18565195011" }, "unknown params dropped, never followed");
eq(parseDialLink("eskewphone://dial?number=8565195011&name=%28212%29%20555-0100"), { number: "+18565195011" }, "name that looks like a number dropped");
eq(parseDialLink("eskewphone://dial?number=13175552210"), { number: "+13175552210" }, "11 digits with 1");
eq(parseDialLink("eskewphone://dial?number=011442079460958"), { number: "+442079460958" }, "011 prefix → +");
eq(parseDialLink("eskewphone://dial?number=00442079460958"), { number: "+442079460958" }, "00 prefix → +");
eq(parseDialLink("eskewphone://dial?number=%2B6591234567"), { number: "+6591234567" }, "+intl never given +1");

// Refused
const refused = [
  ["", "empty"],
  [null, "not a string"],
  ["https://eskewphone.info/calls?dial=8565195011", "https link"],
  ["tel:8565195011", "tel link"],
  ["eskewphone://call?number=8565195011", "other action"],
  ["eskewphone://dial/extra?number=8565195011", "extra path"],
  ["eskewphone://user:pw@dial?number=8565195011", "credentials"],
  ["eskewphone://user@dial?number=8565195011", "username only"],
  ["eskewphone://dial:99?number=8565195011", "port"],
  ["eskewphone://dial", "no number"],
  ["eskewphone://dial?number=", "empty number"],
  ["eskewphone://dial?number=8565195011&number=2125551212", "two numbers"],
  ["eskewphone://dial?number=8565195011&name=a&name=b", "two names"],
  ["eskewphone://dial?number=911", "short code"],
  ["eskewphone://dial?number=123456", "too short"],
  ["eskewphone://dial?number=1234567890123456789", "too long (19)"],
  ["eskewphone://dial?number=%2B1234567890123456", "+ and 16 digits"],
  ["eskewphone://dial?number=%2B0442079460958", "+0 trunk prefix"],
  ["eskewphone://dial?number=1175552210", "area code starting 1"],
  ["eskewphone://dial?number=0175552210", "area code starting 0"],
  ["eskewphone://dial?number=23175552210", "11 digits not starting 1"],
  ["eskewphone://dial?number=5550100", "7 digits"],
  ["eskewphone://dial?number=555010012", "9 digits"],
  ["eskewphone://dial?number=%2B911", "+911"],
  ["eskewphone://dial?number=856-519-5011", "separators"],
  ["eskewphone://dial?number=8565195011x22", "extension glued on"],
  ["eskewphone://dial?number=+442071234567", "raw + (decodes to a space)"],
  ["eskewphone://dial?number=%2B%2B442071234567", "double +"],
  ["eskewphone://dial?number=*678565195011", "star code"],
  ["eskewphone://dial?number=" + "1".repeat(2000), "oversized link"],
];
for (const [raw, label] of refused) eq(parseDialLink(raw), null, `refused: ${label}`);

// Command line (Windows)
eq(dialLinkFromArgv(["--allow-file-access-from-files", "eskewphone://dial?number=8565195011"]), "eskewphone://dial?number=8565195011", "argv finds the link after chromium flags");
eq(dialLinkFromArgv(["C:\\x\\Eskew Phone.exe"]), null, "argv without a link");
eq(dialLinkFromArgv([]), null, "empty argv");

// Target page: always our own base, params re-encoded
eq(dialPageUrl(BASE, { number: "8565195011" }), "https://eskewphone.info/calls?dial=8565195011", "page url, no name");
eq(dialPageUrl(BASE + "/", { number: "+442071234567", name: "Jane & Co" }), "https://eskewphone.info/calls?dial=%2B442071234567&name=Jane+%26+Co", "page url, encoded");
const page = new URL(dialPageUrl(BASE, parseDialLink("eskewphone://dial?number=8565195011&name=Jane%20Doe")));
eq([page.origin, page.pathname, page.searchParams.get("dial"), page.searchParams.get("name")], [BASE, "/calls", "+18565195011", "Jane Doe"], "round trip");

eq(normalizeDialNumber("3175552210"), "+13175552210", "normalize direct");
console.log(`dial-link: ${n} checks passed`);
