// Small synthesized sounds tied to real chain events; nothing is played
// before the user's first click, and the choice to mute is remembered.
const KEY = "trickle.muted";
let ctx;
let muted = false;
// Storage can be blocked by the browser; sound settings must never stop the app.
try {
  muted = localStorage.getItem(KEY) === "1";
} catch {}

export const isMuted = () => muted;
export function setMuted(value) {
  muted = value;
  try {
    localStorage.setItem(KEY, value ? "1" : "0");
  } catch {}
}

function tone(freq, start, length, gain, type = "sine") {
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ctx.currentTime + start);
  amp.gain.setValueAtTime(0, ctx.currentTime + start);
  amp.gain.linearRampToValueAtTime(gain, ctx.currentTime + start + 0.01);
  amp.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + length);
  osc.connect(amp).connect(ctx.destination);
  osc.start(ctx.currentTime + start);
  osc.stop(ctx.currentTime + start + length + 0.02);
}

function play(notes) {
  if (muted) return;
  try {
    ctx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
    for (const n of notes) tone(...n);
  } catch {
    // Audio is decoration; never let it break a transaction flow.
  }
}

// A water drop: a short pitch fall.
export const drop = () => play([[1400, 0, 0.09, 0.05], [700, 0.03, 0.12, 0.04]]);
// Confirmed on chain: a rising two-note chime.
export const confirmed = () => play([[660, 0, 0.18, 0.06], [990, 0.11, 0.3, 0.06]]);
// Coins arriving in the wallet.
export const coins = () => play([[1318, 0, 0.1, 0.05, "triangle"], [1568, 0.07, 0.1, 0.05, "triangle"], [2093, 0.14, 0.35, 0.05, "triangle"]]);
// A failed transaction: a low, short buzz.
export const failed = () => play([[196, 0, 0.22, 0.05, "square"]]);
