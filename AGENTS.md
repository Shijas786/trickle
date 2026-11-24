# Working in this repository

- `gno/p/trickle` is a pure package (no state, no clock); `gno/r/trickle` is the realm. `.gno` is not Go: read the Gno docs on interrealm calls before touching caller or payment checks.
- Test Gno code from `gno/` with `gno test ./...` (the empty `gnowork.toml` makes the realm resolve the local package).
- The module paths contain the deployer address. A deployed package is immutable, so a changed realm needs a new path.
- Web app: `cd web && npm ci && npm run build`. `?net=dev` points it at a local `gnodev`.
- Never commit keys or mnemonics.
