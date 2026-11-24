import { GnoWallet } from "@gnolang/gno-js-client";
import { provider } from "./chain.js";
import { NET, REALM, gasFor, feeFor, depositFor } from "./config.js";

// Browsers can block site storage; fall back to memory so the app still works
// for the visit (the demo wallet is then forgotten on reload).
const memory = new Map();
const store = {
  getItem(k) { try { return localStorage.getItem(k); } catch { return memory.get(k) ?? null; } },
  setItem(k, v) { try { localStorage.setItem(k, v); } catch { memory.set(k, v); } },
  removeItem(k) { try { localStorage.removeItem(k); } catch { memory.delete(k); } },
};

const BURNER_KEY = "trickle.burner.v1";
const LAST_KIND = "trickle.wallet.kind";

let current = null; // { kind, address, call(func, args, sendUgnot) }
const listeners = new Set();
export const onChange = (fn) => listeners.add(fn);
const emit = () => listeners.forEach((fn) => fn(current));
export const wallet = () => current;
export const hasAdena = () => typeof window.adena !== "undefined";

const KNOWN_ERRORS = [
  [/InsufficientCoins|InsufficientFunds|insufficient (coins|funds)/i, "This wallet does not hold enough GNOT for that amount plus the network fee."],
  [/OutOfGas|out of gas/i, "The transaction ran out of gas. Try again."],
  [/UnknownAddress|unknown address/i, "This wallet has no GNOT yet. Fund it from the faucet first."],
  [/InvalidSequence|sequence/i, "The wallet was busy with another transaction. Try again."],
  [/reject|denied|cancell?ed by user/i, "You rejected the transaction in the wallet."],
  [/Failed to fetch|NetworkError|timeout/i, "Could not reach the network. Check your connection and try again."],
];

function clean(message) {
  const text = String(message?.message ?? message ?? "transaction failed");
  // Realm panics come back wrapped in VM traces; keep the human part.
  const m = /Data: (.*?)(\n|$)/.exec(text) || /panic: (.*?)(\n|$)/.exec(text);
  const core = (m ? m[1] : text).replace(/^(errors\.\w+|&errors\.\w+)?\{?s?:?"?/, "").replace(/"?\}?$/, "");
  for (const [pattern, friendly] of KNOWN_ERRORS) {
    if (pattern.test(text) && (!m || /abciError|^\w+(\.\w+)*\{/.test(m[1]))) return friendly;
  }
  // Anything that still looks like a Go value is not worth showing.
  if (/^\w+\.\w+\{|abciError/.test(core)) return "The transaction failed on chain. Nothing was sent apart from the network fee.";
  return core.slice(0, 240);
}

async function connectAdena() {
  const adena = window.adena;
  const est = await adena.AddEstablish("Trickle");
  if (est.status !== "success" && est.type !== "ALREADY_CONNECTED") {
    throw new Error("Adena connection was rejected");
  }
  const acct = await adena.GetAccount();
  if (acct.status !== "success") throw new Error("Could not read the Adena account");
  if (acct.data.chainId !== NET.chainId) {
    const sw = await adena.SwitchNetwork(NET.chainId);
    if (sw.status !== "success" && sw.type !== "REDUNDANT_CHANGE_REQUEST") {
      throw new Error(`Switch Adena to ${NET.label} (${NET.chainId}) and reconnect`);
    }
  }
  const address = acct.data.address;
  adena.On?.("changedAccount", () => connect("adena").catch(() => disconnect()));
  return {
    kind: "adena",
    address,
    async call(func, args, sendUgnot = 0, streams = 1) {
      const gas = gasFor(streams);
      const res = await adena.DoContract({
        messages: [
          {
            type: "/vm.m_call",
            value: {
              caller: address,
              send: sendUgnot ? `${sendUgnot}ugnot` : "",
              pkg_path: REALM,
              func,
              args: args.map(String),
              max_deposit: `${depositFor(streams)}ugnot`,
            },
          },
        ],
        gasFee: feeFor(gas),
        gasWanted: gas,
      });
      if (res.status !== "success") throw new Error(clean(res.message || res.data?.error || res.type));
      return res.data?.hash ?? "";
    },
  };
}

function burnerKey() {
  let hex = store.getItem(BURNER_KEY);
  if (!hex) {
    hex = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
    store.setItem(BURNER_KEY, hex);
  }
  return Uint8Array.from(hex.match(/../g), (h) => parseInt(h, 16));
}

// A throwaway key kept in this browser, so anyone can try the app on testnet
// without installing an extension. Never use it for anything of value.
async function connectBurner() {
  const w = await GnoWallet.fromPrivateKey(burnerKey());
  w.connect(await provider());
  const address = await w.getAddress();
  return {
    kind: "burner",
    address,
    async call(func, args, sendUgnot = 0, streams = 1) {
      const gas = gasFor(streams);
      try {
        const res = await w.callMethod(
          REALM,
          func,
          args,
          "broadcast_tx_commit",
          sendUgnot ? new Map([["ugnot", sendUgnot]]) : undefined,
          new Map([["ugnot", depositFor(streams)]]),
          { gas_wanted: BigInt(gas), gas_fee: `${feeFor(gas)}ugnot` },
        );
        const err = res.check_tx?.ResponseBase?.Error || res.deliver_tx?.ResponseBase?.Error;
        if (err) throw new Error(res.deliver_tx?.ResponseBase?.Log || res.check_tx?.ResponseBase?.Log || JSON.stringify(err));
        return res.hash ?? "";
      } catch (e) {
        const log = e?.log || e?.message || e;
        if (/unknown address|insufficient (funds|coins)/i.test(String(log))) {
          throw new Error("This wallet has no GNOT yet. Fund it from the faucet first.");
        }
        throw new Error(clean(log));
      }
    },
  };
}

export async function connect(kind) {
  current = kind === "adena" ? await connectAdena() : await connectBurner();
  store.setItem(LAST_KIND, kind);
  emit();
  return current;
}

export function disconnect() {
  current = null;
  store.removeItem(LAST_KIND);
  emit();
}

export async function restore() {
  const kind = store.getItem(LAST_KIND);
  if (kind === "burner" || (kind === "adena" && hasAdena())) {
    try {
      await connect(kind);
    } catch {
      disconnect();
    }
  }
}
