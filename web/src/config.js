const OWNER = "g1a04glq8w6ts7r9yzyznpa99qkzwp8pewcf3aef";

const NETWORKS = {
  onyx: {
    label: "Onyx testnet",
    chainId: "onyx-1",
    rpc: "https://rpc.onyx.testnets.gno.land:443",
    web: "https://onyx.testnets.gno.land",
    faucet: "https://faucet.gno.land",
  },
  dev: {
    label: "Local gnodev",
    chainId: "dev",
    rpc: "http://127.0.0.1:26657",
    web: "http://127.0.0.1:8888",
    faucet: "",
  },
};

const requested = new URLSearchParams(location.search).get("net");
export const NET = NETWORKS[requested] ?? NETWORKS.onyx;
export const NET_KEY = NETWORKS[requested] ? requested : "onyx";
export const REALM = `gno.land/r/${OWNER}/trickle`;
export const REALM_URL = `${NET.web}/r/${OWNER}/trickle`;

// Measured on the realm: one stream costs about 20M gas and each further
// recipient in a payroll about 7.5M, so the limit grows with the batch.
// Gas price on Onyx is 1 ugnot per 1000 gas and the whole fee is charged.
export const gasFor = (streams = 1) => 40_000_000 + 10_000_000 * streams;
export const feeFor = (gas) => Math.ceil(gas / 1000);
// Gno charges a storage deposit of 100 ugnot per byte, locked while the data
// exists. A new stream writes about 8 KB, so about 0.8 GNOT each; this is the
// ceiling a call may lock.
export const STORAGE_PER_STREAM_UGNOT = 800_000;
export const depositFor = (streams = 1) => 1_000_000 + 1_000_000 * streams;
