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

// Gas price on Onyx is 1 ugnot per 1000 gas; a call uses about 8M gas.
export const GAS_WANTED = 30_000_000;
export const GAS_FEE_UGNOT = 100_000;
// Ceiling on the storage deposit a call may lock (refunded when storage is freed).
export const MAX_DEPOSIT_UGNOT = 3_000_000;
