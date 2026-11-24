import { GnoJSONRPCProvider } from "@gnolang/gno-js-client";
import { NET, REALM } from "./config.js";

let providerPromise;
export function provider() {
  providerPromise ??= GnoJSONRPCProvider.create(NET.rpc);
  return providerPromise;
}

// qeval answers `("<go-quoted string>" string)`; our realm only returns JSON
// built from validated UTF-8, so the Go quoting is also valid JSON quoting.
function unwrap(result) {
  const m = /^\((".*") string\)\s*$/s.exec(result);
  if (!m) throw new Error("unexpected response: " + result.slice(0, 120));
  return JSON.parse(JSON.parse(m[1]));
}

async function evalJSON(expr) {
  const p = await provider();
  return unwrap(await p.evaluateExpression(REALM, expr));
}

const isAddress = (a) => /^g1[0-9a-z]{38}$/.test(a);

export const stats = () => evalJSON("StatsJSON()");
export const latest = (limit = 50) => evalJSON(`LatestJSON(0,${limit})`);
export const stream = (id) => evalJSON(`StreamJSON(${Number(id)})`);
export async function incoming(addr) {
  if (!isAddress(addr)) return [];
  return evalJSON(`IncomingJSON("${addr}",0,50)`);
}
export async function outgoing(addr) {
  if (!isAddress(addr)) return [];
  return evalJSON(`OutgoingJSON("${addr}",0,50)`);
}
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
