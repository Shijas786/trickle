import * as chain from "./chain.js";
import { NET, REALM_URL } from "./config.js";
import { wallet, connect, disconnect, restore, onChange, hasAdena } from "./wallet.js";

const $ = (sel, root = document) => root.querySelector(sel);
const app = $("#app");

// ---------- helpers ----------

// h builds DOM nodes; strings are always inserted as text, never as HTML.
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (k === "style") el.style.cssText = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

const UGNOT = 1_000_000;
const fmt = (ugnot, digits = 6) =>
  (ugnot / UGNOT).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const fmtShort = (ugnot) => (ugnot / UGNOT).toLocaleString("en-US", { maximumFractionDigits: 6 });
const short = (a) => `${a.slice(0, 8)}…${a.slice(-4)}`;
const UNITS = { minutes: 60, hours: 3600, days: 86400, weeks: 604800, months: 2592000, years: 31536000 };

function duration(seconds) {
  if (seconds <= 0) return "0s";
  const parts = [];
  for (const [name, size] of [["d", 86400], ["h", 3600], ["m", 60], ["s", 1]]) {
    const n = Math.floor(seconds / size);
    if (n) parts.push(n + name);
    seconds -= n * size;
    if (parts.length === 2) break;
  }
  return parts.join(" ");
}

// rate picks the unit a person would quote for a stream of this length.
function rate(ugnot, seconds) {
  const [unit, size] = seconds >= 2 * 86400 ? ["day", 86400] : seconds >= 2 * 3600 ? ["hour", 3600] : ["minute", 60];
  return `${fmtShort(Math.round((ugnot * size) / seconds))} GNOT/${unit}`;
}

function toast(message, isError = false) {
  const t = h("div", { class: "toast" + (isError ? " err" : "") }, message);
  $("#toasts").append(t);
  setTimeout(() => t.remove(), isError ? 9000 : 5000);
}

// Chain time can differ from this machine's clock; tick against the chain's.
let clockOffset = 0;
const now = () => Date.now() / 1000 + clockOffset;

// ---------- live ticking ----------

const tickers = new Set();
function frame() {
  const t = now();
  for (const fn of tickers) fn(t);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------- transactions ----------

let busy = false;
async function send(label, func, args, sendUgnot = 0) {
  const w = wallet();
  if (!w) return toast("Connect a wallet first.", true);
  if (busy) return;
  busy = true;
  document.body.style.cursor = "progress";
  try {
    await w.call(func, args.map(String), sendUgnot);
    toast(label);
    return true;
  } catch (e) {
    toast(e.message || String(e), true);
    return false;
  } finally {
    busy = false;
    document.body.style.cursor = "";
    refreshBalance();
  }
}

// ---------- wallet UI ----------

let myBalance = null;
async function refreshBalance() {
  const w = wallet();
  myBalance = null;
  if (w) {
    try {
      myBalance = await chain.balance(w.address);
    } catch {
      myBalance = null;
    }
  }
  renderWallet();
}

function renderWallet() {
  const box = $("#wallet");
  box.replaceChildren();
  const w = wallet();
  if (w) {
    box.append(
      myBalance != null && h("span", { class: "small muted amount" }, fmtShort(myBalance) + " GNOT"),
      h("button", {
        class: "addr mono", title: `${w.address} (click to copy)`,
        onclick: () => navigator.clipboard?.writeText(w.address).then(() => toast("Address copied")),
      }, (w.kind === "burner" ? "Demo · " : "") + short(w.address)),
      h("button", { onclick: disconnect, title: "Disconnect" }, "✕"),
    );
    return;
  }
  const open = () => {
    if ($(".menu", box)) return $(".menu", box).remove();
    box.append(h("div", { class: "menu" },
      h("button", {
        disabled: !hasAdena(),
        onclick: () => doConnect("adena"),
      }, "Adena wallet", h("span", {}, hasAdena() ? "Use your Adena browser extension" : "Extension not detected in this browser")),
      h("button", { onclick: () => doConnect("burner") },
        "Demo wallet", h("span", {}, "A throwaway testnet key kept in this browser. No install needed.")),
    ));
  };
  box.append(h("button", { class: "primary", id: "connect", onclick: open }, "Connect wallet"));
}

async function doConnect(kind) {
  try {
    await connect(kind);
  } catch (e) {
    toast(e.message || String(e), true);
  }
}

// ---------- stream card ----------

function streamCard(s) {
  const me = wallet()?.address;
  const mine = me === s.recipient ? "in" : me === s.sender ? "out" : null;
  const amount = h("span", {}, "");
  const sub = h("small", {}, "");
  const pill = h("span", { class: "pill" }, "");
  const paid = h("em", {});
  const fill = h("i", {});
  const acts = h("div", { class: "acts" });
  const left = h("b", {}, "");

  let lastStatus = null;
  const update = (t) => {
    const fine = s.canceledAt ? s.deposit - s.refunded
      : t < s.cliff || t <= s.start ? 0
      : t >= s.end ? s.deposit
      : (s.deposit * (t - s.start)) / (s.end - s.start);
    const st = chain.statusOf(s, t);
    if (mine === "in") {
      amount.textContent = fmt(Math.max(0, fine - s.withdrawn));
      sub.textContent = ` GNOT to withdraw · ${fmtShort(s.deposit)} total`;
    } else {
      amount.textContent = fmt(fine);
      sub.textContent = ` of ${fmtShort(s.deposit)} GNOT streamed`;
    }
    fill.style.width = (fine / s.deposit) * 100 + "%";
    paid.style.width = (s.withdrawn / s.deposit) * 100 + "%";
    left.textContent = st === "scheduled" ? "starts in " + duration(s.start - t)
      : st === "cliff" ? "cliff ends in " + duration(s.cliff - t)
      : st === "streaming" ? duration(s.end - t) + " left"
      : st === "canceled" ? `${fmtShort(s.refunded)} GNOT refunded`
      : "fully streamed";
    if (st !== lastStatus) {
      lastStatus = st;
      pill.className = "pill " + st;
      pill.textContent = st;
      renderActs(st);
    }
  };

  const act = async (label, func, args) => {
    if (await send(label, func, args)) route();
  };
  function renderActs(st) {
    acts.replaceChildren();
    if (!mine || st === "canceled" || st === "settled") return;
    const live = st !== "completed";
    if (mine === "in") {
      acts.append(h("button", {
        class: "primary", disabled: st === "scheduled" || st === "cliff",
        onclick: () => act("Withdrawn to your wallet", "Withdraw", [s.id, 0]),
      }, "Withdraw"));
      if (live) {
        acts.append(
          h("button", {
            onclick: () => {
              const to = prompt("Transfer this stream to which address?");
              if (to == null) return;
              if (!chain.isAddress(to.trim())) return toast("That is not a valid g1… address.", true);
              act("Stream transferred", "Transfer", [s.id, to.trim()]);
            },
          }, "Transfer"),
          h("button", {
            class: "danger",
            onclick: () => confirm("Stop this stream? You keep what has unlocked; the rest returns to the sender.")
              && act("Stream stopped", "Cancel", [s.id]),
          }, "Decline"),
        );
      }
    } else if (live && s.cancelable) {
      acts.append(h("button", {
        class: "danger",
        onclick: () => confirm("Cancel this stream? The recipient keeps what has unlocked; the rest returns to you.")
          && act("Stream canceled, remainder refunded", "Cancel", [s.id]),
      }, "Cancel & refund"));
    }
  }

  const card = h("div", { class: "card" },
    h("div", { class: "head" }, h("a", { href: `${REALM_URL}:stream/${s.id}`, target: "_blank", rel: "noopener" }, `Stream #${s.id}`), pill),
    h("div", { class: "amount" }, amount, sub),
    h("div", { class: "bar" }, fill, paid),
    s.memo && h("div", { class: "memo" }, s.memo),
    h("div", { class: "row" }, h("span", {}, "From ", h("b", { class: "mono", title: s.sender }, short(s.sender))), h("span", {}, "To ", h("b", { class: "mono", title: s.recipient }, short(s.recipient)))),
    h("div", { class: "row" }, h("span", {}, rate(s.deposit, s.end - s.start)), left),
    acts,
  );
  update(now());
  tickers.add(update);
  return card;
}

function grid(list, emptyText) {
  if (!list.length) return h("div", { class: "empty" }, emptyText);
  return h("div", { class: "grid" }, list.map(streamCard));
}

function statsRow(st) {
  const cell = (k, v) => h("div", { class: "stat" }, h("div", { class: "k" }, k), h("div", { class: "v amount" }, v));
  return h("div", { class: "stats" },
    cell("Streams", st.streams),
    cell("Total streamed in", fmtShort(st.deposited) + " GNOT"),
    cell("Paid out", fmtShort(st.paid) + " GNOT"),
    cell("Locked now", fmtShort(st.locked) + " GNOT"),
  );
}

// ---------- views ----------

async function viewHome() {
  const w = wallet();
  const st = await chain.stats();
  clockOffset = st.now - Date.now() / 1000;

  if (!w) {
    const demo = h("div", { class: "amount" }, "");
    const t0 = now();
    tickers.add((t) => { demo.textContent = "+" + fmt(((t - t0) * 3000 * UGNOT) / 2592000) + " GNOT"; });
    return [
      h("section", { class: "hero" },
        h("div", {},
          h("h1", {}, "Money that arrives every second."),
          h("p", { class: "lead" }, "Lock GNOT once and it unlocks for the recipient continuously: salaries, grants, vesting with a cliff, subscriptions. They withdraw whenever they like. Cancel any time and only the unearned part comes back."),
          h("div", { class: "actions" },
            h("button", { class: "primary", onclick: () => doConnect("burner") }, "Try it with a demo wallet"),
            h("a", { class: "btn", href: "#/explore" }, "Explore live streams"),
          ),
        ),
        h("div", { class: "demo" },
          h("div", { class: "muted small" }, "A 3,000 GNOT monthly salary, since you opened this page"),
          demo,
          h("div", { class: "muted small", style: "margin-top:8px" }, "Paid by the second instead of on the 30th."),
        ),
      ),
      statsRow(st),
    ];
  }

  const [inc, out] = await Promise.all([chain.incoming(w.address), chain.outgoing(w.address)]);
  return [
    myBalance === 0 && h("div", { class: "banner" },
      h("span", {}, "This wallet has no testnet GNOT yet. Copy your address and request some from the faucet."),
      h("span", { style: "display:flex;gap:8px" },
        h("button", { onclick: () => navigator.clipboard?.writeText(w.address).then(() => toast("Address copied")) }, "Copy address"),
        NET.faucet && h("a", { class: "btn primary", href: NET.faucet, target: "_blank", rel: "noopener" }, "Open faucet"),
      ),
    ),
    h("h2", { style: "margin-top:0" }, "Incoming"),
    grid(inc, "Nobody is streaming to you yet. Share your address to get paid by the second."),
    h("h2", {}, "Outgoing"),
    grid(out, "You have not opened a stream yet."),
    !out.length && h("p", {}, h("a", { class: "btn primary", href: "#/new" }, "Open your first stream")),
  ];
}

async function viewExplore() {
  const [st, list] = await Promise.all([chain.stats(), chain.latest(50)]);
  clockOffset = st.now - Date.now() / 1000;
  return [
    h("h1", {}, "Live on " + NET.label),
    h("p", { class: "lead" }, "Every stream is public state in the Trickle realm. These are the latest."),
    statsRow(st),
    h("h2", {}, "Latest streams"),
    grid(list, "No streams yet. Be the first."),
  ];
}

function scheduleFields() {
  return [
    h("div", { class: "two" },
      h("div", {}, h("label", { for: "dur" }, "Stream over"), h("input", { id: "dur", type: "number", min: "1", step: "1", value: "30", required: true })),
      h("div", {}, h("label", { for: "durUnit" }, "Unit"), unitSelect("durUnit", "days")),
    ),
    h("div", { class: "two" },
      h("div", {}, h("label", { for: "cliff" }, "Cliff (nothing withdrawable before)"), h("input", { id: "cliff", type: "number", min: "0", step: "1", value: "0" })),
      h("div", {}, h("label", { for: "cliffUnit" }, "Unit"), unitSelect("cliffUnit", "days")),
    ),
    h("div", { class: "two" },
      h("div", {}, h("label", { for: "delay" }, "Start after (0 = now)"), h("input", { id: "delay", type: "number", min: "0", step: "1", value: "0" })),
      h("div", {}, h("label", { for: "delayUnit" }, "Unit"), unitSelect("delayUnit", "hours")),
    ),
    h("label", { for: "memo" }, "Memo (optional, public)"),
    h("input", { id: "memo", type: "text", maxlength: "80", placeholder: "March salary" }),
    h("label", { class: "check" },
      h("input", { id: "cancelable", type: "checkbox", checked: true }),
      h("span", {}, "I can cancel and reclaim what has not unlocked", h("br"), h("span", { class: "muted small" }, "Untick for a commitment the recipient can rely on, such as vesting.")),
    ),
  ];
}

function unitSelect(id, selected) {
  return h("select", { id }, Object.keys(UNITS).map((u) => h("option", { value: u, selected: u === selected }, u)));
}

function readSchedule(form) {
  const v = (id) => $("#" + id, form).value;
  const secs = (id) => Math.round(Number(v(id) || 0) * UNITS[v(id + "Unit")]);
  const durationS = secs("dur"), cliffS = secs("cliff"), delayS = secs("delay");
  if (!(durationS > 0)) throw new Error("Enter how long the stream should run.");
  if (cliffS > durationS) throw new Error("The cliff cannot be longer than the stream.");
  if (new TextEncoder().encode(v("memo")).length > 80) throw new Error("The memo is too long (80 bytes at most).");
  return { durationS, cliffS, delayS, memo: v("memo"), cancelable: $("#cancelable", form).checked };
}

const toUgnot = (text) => {
  const n = Number(String(text).trim());
  if (!Number.isFinite(n) || n <= 0) return NaN;
  return Math.round(n * UGNOT);
};

function describe(sch, total) {
  return [
    `${rate(total, sch.durationS)} (${fmt(total / sch.durationS, 6)} per second) for ${duration(sch.durationS)}`,
    sch.cliffS ? `, first withdrawal after ${duration(sch.cliffS)}` : "",
    sch.delayS ? `, starting in ${duration(sch.delayS)}` : ", starting now",
    sch.cancelable ? ". You can cancel any time." : ". Cannot be canceled by you.",
  ].join("");
}

async function viewNew() {
  const summary = h("div", { class: "summary" }, "");
  const submit = h("button", { class: "primary", type: "submit" }, "Start streaming");
  const form = h("form", { class: "panel" },
    h("label", { for: "to" }, "Recipient address"),
    h("input", { id: "to", type: "text", placeholder: "g1…", required: true, autocomplete: "off", spellcheck: "false" }),
    h("label", { for: "amt" }, "Total amount (GNOT)"),
    h("input", { id: "amt", type: "text", inputmode: "decimal", placeholder: "100", required: true, autocomplete: "off" }),
    scheduleFields(),
    summary,
    h("div", { class: "submit" }, submit, h("span", { class: "muted small" }, "Network fee about 0.1 GNOT, plus a refundable storage deposit of about 0.5 GNOT.")),
  );
  const read = () => {
    const to = $("#to", form).value.trim();
    const total = toUgnot($("#amt", form).value);
    if (!chain.isAddress(to)) throw new Error("Enter the recipient's g1… address.");
    if (to === wallet()?.address) throw new Error("You cannot stream to yourself.");
    if (!total) throw new Error("Enter the total amount to stream.");
    return { to, total, ...readSchedule(form) };
  };
  const refresh = () => {
    try {
      const d = read();
      summary.className = "summary";
      summary.textContent = `${short(d.to)} receives ${describe(d, d.total)}`;
    } catch (e) {
      summary.className = "summary muted";
      summary.textContent = e.message;
    }
  };
  form.addEventListener("input", refresh);
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    let d;
    try { d = read(); } catch (e) { return toast(e.message, true); }
    submit.disabled = true;
    const startAt = d.delayS ? Math.floor(now()) + d.delayS : 0;
    const ok = await send("Stream opened", "Create", [d.to, startAt, d.cliffS, d.durationS, d.cancelable, d.memo], d.total);
    submit.disabled = false;
    if (ok) location.hash = "#/";
  });
  refresh();
  return [h("h1", {}, "New stream"), h("p", { class: "lead" }, "The full amount is locked in the realm now and unlocks for the recipient second by second."), form];
}

async function viewPayroll() {
  const summary = h("div", { class: "summary" }, "");
  const submit = h("button", { class: "primary", type: "submit" }, "Run payroll");
  const form = h("form", { class: "panel" },
    h("label", { for: "rows" }, "One recipient per line: address, amount in GNOT (up to 50)"),
    h("textarea", { id: "rows", required: true, spellcheck: "false", placeholder: "g1abc…, 1200\ng1def…, 950.5" }),
    scheduleFields(),
    summary,
    h("div", { class: "submit" }, submit, h("span", { class: "muted small" }, "One transaction opens every stream.")),
  );
  const read = () => {
    const rows = $("#rows", form).value.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!rows.length) throw new Error("Add at least one recipient.");
    if (rows.length > 50) throw new Error("At most 50 recipients per payroll.");
    let total = 0;
    const pairs = rows.map((line, i) => {
      const [addr, amt] = line.split(/[,\s]+/);
      const u = toUgnot(amt);
      if (!chain.isAddress(addr || "")) throw new Error(`Line ${i + 1}: not a valid g1… address.`);
      if (addr === wallet()?.address) throw new Error(`Line ${i + 1}: you cannot stream to yourself.`);
      if (!u) throw new Error(`Line ${i + 1}: enter an amount after the address.`);
      total += u;
      return `${addr}:${u}`;
    });
    return { pairs, total, ...readSchedule(form) };
  };
  const refresh = () => {
    try {
      const d = read();
      summary.className = "summary";
      summary.textContent = `${d.pairs.length} streams, ${fmtShort(d.total)} GNOT in total: ${describe(d, d.total)}`;
    } catch (e) {
      summary.className = "summary muted";
      summary.textContent = e.message;
    }
  };
  form.addEventListener("input", refresh);
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    let d;
    try { d = read(); } catch (e) { return toast(e.message, true); }
    submit.disabled = true;
    const startAt = d.delayS ? Math.floor(now()) + d.delayS : 0;
    const ok = await send(`${d.pairs.length} streams opened`, "CreateBatch", [d.pairs.join(","), startAt, d.cliffS, d.durationS, d.cancelable, d.memo], d.total);
    submit.disabled = false;
    if (ok) location.hash = "#/";
  });
  refresh();
  return [h("h1", {}, "Payroll"), h("p", { class: "lead" }, "Pay a whole team on the same schedule in a single transaction."), form];
}

// ---------- router ----------

const routes = { "": ["home", viewHome], new: ["new", viewNew], payroll: ["payroll", viewPayroll], explore: ["explore", viewExplore] };
let renderSeq = 0;

async function route() {
  const key = location.hash.replace(/^#\/?/, "");
  const [tab, view] = routes[key] ?? routes[""];
  for (const a of document.querySelectorAll("#nav a")) a.classList.toggle("active", a.dataset.tab === tab);
  const seq = ++renderSeq;
  try {
    tickers.clear();
    const nodes = await view();
    if (seq !== renderSeq) return;
    app.replaceChildren(...nodes.filter(Boolean));
  } catch (e) {
    if (seq !== renderSeq) return;
    tickers.clear();
    app.replaceChildren(h("div", { class: "empty" }, `Could not reach ${NET.label}: ${e.message || e}`));
  }
}

$("#net").textContent = `${NET.label} · ${NET.chainId}`;
$("#realm-link").href = REALM_URL;

window.addEventListener("hashchange", route);
onChange(async () => {
  await refreshBalance();
  route();
});
// Pick up new blocks: streams others opened, withdrawals made elsewhere.
setInterval(() => {
  if (!busy && !document.hidden && !$("form", app)) route();
}, 20000);

renderWallet();
route();
restore();
