import { GnoJSONRPCProvider } from "@gnolang/gno-js-client";
import { NET, REALM } from "./config.js";

let providerPromise;
export function provider() {
  providerPromise ??= GnoJSONRPCProvider.create(NET.rpc);
  return providerPromise;
}

// qeval answers `("<go-quoted string>" string)`. Go quoting is not JSON
// quoting (\x7f, \U000e0067, \a, \v), so decode it by Go's rules.
const SIMPLE = { a: "\x07", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v", "\\": "\\", '"': '"', "'": "'" };
export function goUnquote(quoted) {
  const body = quoted.slice(1, -1);
  const bytes = [];
  const enc = new TextEncoder();
  const push = (text) => bytes.push(...enc.encode(text));
  for (let i = 0; i < body.length; ) {
    if (body[i] !== "\\") {
      const cp = body.codePointAt(i);
      const ch = String.fromCodePoint(cp);
      push(ch);
      i += ch.length;
      continue;
    }
    const c = body[i + 1];
    if (c in SIMPLE) { push(SIMPLE[c]); i += 2; continue; }
    const hex = (len, radix = 16) => {
      const digits = body.slice(i + 2, i + 2 + len);
      const n = parseInt(digits, radix);
      if (digits.length !== len || Number.isNaN(n)) throw new Error("bad escape in response");
      i += 2 + len;
      return n;
    };
    if (c === "x") bytes.push(hex(2));
    else if (c === "u") push(String.fromCodePoint(hex(4)));
    else if (c === "U") push(String.fromCodePoint(hex(8)));
    else if (c >= "0" && c <= "7") { i -= 1; bytes.push(hex(3, 8)); }
    else throw new Error("bad escape in response");
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

function unwrap(result) {
  const m = /^\((".*") string\)\s*$/s.exec(result);
  if (!m) throw new Error("unexpected response: " + result.slice(0, 120));
  return JSON.parse(goUnquote(m[1]));
}

async function evalJSON(expr) {
  const p = await provider();
  return unwrap(await p.evaluateExpression(REALM, expr));
}

// Full Bech32 check, checksum included: a mistyped address must be caught
// here, not by a transaction that fails after its fee is paid.
const B32 = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const B32_GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
function bech32Polymod(values) {
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= B32_GEN[i];
  }
  return chk >>> 0;
}
function isAddress(a) {
  // "g1" + 32 data characters (20 bytes) + 6 checksum characters.
  if (typeof a !== "string" || !/^g1[02-9ac-hj-np-z]{38}$/.test(a)) return false;
  const words = [...a.slice(2)].map((c) => B32.indexOf(c));
  // Human-readable part "g" expands to [high bits, 0, low bits].
  return bech32Polymod([0x67 >> 5, 0, 0x67 & 31, ...words]) === 1;
}

export const stats = () => evalJSON("StatsJSON()");
export const latest = (limit = 50) => evalJSON(`LatestJSON(0,${limit})`);
export const stream = (id) => evalJSON(`StreamJSON(${Number(id)})`);
// The realm serves at most PAGE streams per call; walk the pages so an old
// stream with unclaimed funds is never hidden behind newer ones.
const PAGE = 50;
const MAX_PAGES = 20;
async function allOf(fn, addr) {
  if (!isAddress(addr)) return [];
  const all = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const part = await evalJSON(`${fn}("${addr}",${page * PAGE},${PAGE})`);
    all.push(...part);
    if (part.length < PAGE) break;
  }
  return all;
}
export const incoming = (addr) => allOf("IncomingJSON", addr);
export const outgoing = (addr) => allOf("OutgoingJSON", addr);
export async function balance(addr) {
  const p = await provider();
  return p.getBalance(addr, "ugnot");
}
export { isAddress };

// Mirror of the realm's schedule math, used to tick balances between polls.
export function vested(s, now) {
  if (s.canceledAt) return s.deposit - s.refunded;
  if (now < s.cliff || now <= s.start) return 0;
  if (now >= s.end) return s.deposit;
  return Math.floor((s.deposit * (now - s.start)) / (s.end - s.start));
}

export function statusOf(s, now) {
  if (s.canceledAt) return "canceled";
  if (now < s.start) return "scheduled";
  if (now < s.cliff) return "cliff";
  if (now < s.end) return "streaming";
  return s.withdrawn < s.deposit ? "completed" : "settled";
}
