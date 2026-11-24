# Trickle

**Money that arrives every second: 86,400 paydays a day.** Trickle is a payment-streaming protocol for [Gno.land](https://gno.land): lock GNOT once and it unlocks for the recipient continuously. Salaries, grants, vesting with a cliff, subscriptions. The recipient withdraws whenever they like; if the sender cancels, the recipient keeps what has unlocked and only the unearned part goes back.

Built for the [Gnome Tavern](https://dorahacks.io/hackathon/gnome-tavern/detail) hackathon.

| | |
|---|---|
| Network | Gno.land Onyx testnet (`onyx-1`) |
| Realm | `gno.land/r/g1a04glq8w6ts7r9yzyznpa99qkzwp8pewcf3aef/trickle` |
| Package | `gno.land/p/g1a04glq8w6ts7r9yzyznpa99qkzwp8pewcf3aef/trickle` |
| Realm deploy tx | `UpZyIYf2BYb54w3JUajjs2dFEFsCRjoUJlFH43b1xp0=` (block 1387695) |
| Package deploy tx | `CfFQcwlGWnFPDD8EjEPya0lzDyfuoSRKMah3NC8d4LM=` (block 1387440) |

Onyx stores a new package first and activates it once the chain's package approver enables it. See [Deployment](#deployment) for how to check the state.

## Verify it in two minutes

| Claim | How to check |
|---|---|
| It is deployed on Gno.land testnet | Open the [realm page](https://onyx.testnets.gno.land/r/g1a04glq8w6ts7r9yzyznpa99qkzwp8pewcf3aef/trickle) or run the `qpkgmeta_json` query under [Deployment](#deployment) |
| The logic is real Gno | [`gno/p/trickle/stream.gno`](gno/p/trickle/stream.gno) and [`gno/r/trickle/trickle.gno`](gno/r/trickle/trickle.gno) |
| It is tested | `cd gno && gno test ./...`, or the "Gno tests" check on any commit |
| Money streams per second | Open a stream in the web app and watch the balance tick; the Explore page totals every live stream |
| Funds cannot be stranded or overdrawn | `TestSolvency`, `TestCreateValidation` and `TestCreateRejectsIntermediaries` in [`trickle_test.gno`](gno/r/trickle/trickle_test.gno) |
| It works without the web app | Every action is a link on the realm's own gnoweb pages |

## What it does

- **Streams.** A sender locks a deposit for a recipient with a start, an optional cliff and a duration. The deposit unlocks linearly, one second at a time.
- **Withdraw any time.** The recipient pulls what has unlocked, all of it or part of it.
- **Cancel fairly.** A cancelable stream can be stopped by the sender; a recipient can always decline one. Either way the unlocked part is paid to the recipient and the rest refunded in the same transaction.
- **Commitments.** A stream opened as non-cancelable cannot be clawed back, which is what vesting needs.
- **Transferable.** The recipient can hand a stream to another address.
- **Payroll.** One transaction opens up to 50 streams on the same schedule.
- **Readable on chain.** The realm renders its own pages (home, `:stream/<id>`, `:account/<addr>` with older pages at `:account/<addr>/<page>`) in gnoweb, with progress bars and action links, so it is usable without the web app.

## What is real and what is not

| Part | State |
|---|---|
| Package and realm | Real Gno code, tested in CI, submitted to Onyx; live once the chain's package approver enables them (see [Deployment](#deployment)) |
| Coins | Real testnet GNOT, held by the realm; nothing is simulated |
| Web app | Reads and writes the chain directly; no backend, no indexer |
| Demo wallet | A real key generated in your browser and kept in its storage; testnet only |
| Adena | Supported through its `DoContract` API, not yet tested with the extension |
| Payslip sharing | A link to a public page; anyone can watch a stream, only the recipient can withdraw |

## How it is built

```
gno/p/trickle   pure package: stream schedule and accounting, no state, no clock
gno/r/trickle   realm: GNOT escrow, authorization, indexes, queries, Render
web/            web app: Vite + @gnolang/gno-js-client, Adena or a built-in demo wallet
```

### `p/trickle`: reusable accounting

The package holds no coins and never reads the clock; every method takes `now`. That makes it deterministic, easy to test, and reusable by any realm that wants streaming for GRC20 tokens or points rather than GNOT.

```go
s, err := trickle.New(sender, recipient, deposit, start, cliff, end, cancelable)
s.Withdrawable(now)              // unlocked and not yet withdrawn
paid, err := s.Withdraw(now, 0)  // 0 = everything available
toRecipient, toSender, err := s.CancelBySender(now)
```

It keeps one invariant at every instant, checked by a test that walks a stream through withdrawals and a cancellation:

```
Withdrawn + Withdrawable(now) + Refundable(now) == Deposit
```

Vesting is computed with a 128-bit intermediate (`math/bits`), so `deposit * elapsed` cannot overflow for any `int64` deposit, and rounds down, so the realm can never owe more than it holds.

### `r/trickle`: the realm

| Function | Who | Effect |
|---|---|---|
| `Create(recipient, startAt, cliffSeconds, durationSeconds, cancelable, memo)` | anyone, sending GNOT | opens a stream, returns its id |
| `CreateBatch("g1..:amount,g1..:amount", ...)` | anyone, sending the exact total | opens one stream per recipient |
| `Withdraw(id, amount)` | recipient | pays out unlocked GNOT (`0` = all) |
| `Cancel(id)` | sender if cancelable, or recipient | settles both sides and closes the stream |
| `Transfer(id, to)` | recipient | moves the stream to another address, until it is fully withdrawn |

Read side, for apps and indexers: `StreamJSON`, `StatsJSON`, `LatestJSON`, `IncomingJSON`, `OutgoingJSON` (paginated, served from sender and recipient indexes), plus `Withdrawable` and `Count`. Every state change emits an event (`StreamCreated`, `StreamWithdrawn`, `StreamCanceled`, `StreamTransferred`).

### Security notes

- **Payment verification.** Funding functions require `cur.Previous().IsUserCall()` before reading the origin-send envelope, then exactly one positive `ugnot` coin. `IsUser()` alone would let a `maketx run` script spend the envelope first and still pass. A test covers a wrapper realm trying to call `Create`.
- **Solvency.** The realm tracks deposited, paid and refunded totals; a test asserts the realm's balance always covers what streams still owe.
- **Checks before effects.** Stream state is updated before coins leave the realm.
- **No pointers to state leak.** Queries return JSON strings and values, never a pointer into the stream tree.
- **Render is treated as hostile input.** Path segments are parsed, not echoed, and memos go through `sanitize.InlineText` / `sanitize.TableCell`. Memos are also length-limited and rejected if they contain control characters.
- **Canonical addresses only.** Recipients must be spelled the way the chain spells a caller (lowercase Bech32). Other spellings that pass `IsValid` are rejected, because a stream stored under one could never be withdrawn.
- **Bounded work.** Pages are capped at 50 items, batches at 50 recipients, durations at 100 years.

## Run it locally

Requirements: Go, the Gno toolchain (`gno`, `gnodev`, `gnokey` from [gnolang/gno](https://github.com/gnolang/gno), built at `v1.8.0-rc.1`), and Node 22.

```sh
# tests
cd gno && gno test ./...

# local chain with the package and realm loaded
gnodev local -add-account g1a04glq8w6ts7r9yzyznpa99qkzwp8pewcf3aef=100000000000ugnot \
  -deploy-key g1a04glq8w6ts7r9yzyznpa99qkzwp8pewcf3aef -empty-blocks .

# web app against the local chain
cd web && npm ci && npm run dev    # open http://localhost:5173/?net=dev
```

Without `?net=dev` the app talks to the Onyx testnet.

Open a stream from the command line:

```sh
gnokey maketx call \
  -pkgpath gno.land/r/g1a04glq8w6ts7r9yzyznpa99qkzwp8pewcf3aef/trickle \
  -func Create -args <recipient> -args 0 -args 0 -args 2592000 -args true -args "March salary" \
  -send 100000000ugnot -gas-fee 1000000ugnot -gas-wanted 30000000 \
  -broadcast -chainid onyx-1 -remote https://rpc.onyx.testnets.gno.land:443 <your-key>
```

## The web app

- **My streams**: incoming and outgoing streams with balances that tick every frame, computed from the on-chain schedule and the chain's clock.
- **New stream** and **Payroll**: forms that explain the schedule in plain words before you sign.
- **Explore**: live protocol totals and the latest streams.
- **Payslips**: every stream has a page at `#/s/<id>` with its earnings ticking in large type, a Share button and a WhatsApp link, so a recipient can watch their pay arrive from a message.
- **Live wall**: Explore opens with one large number, the GNOT unlocked by the latest streams, moving in real time, with a QR code to open the app on a phone.
- **Sound and motion**: a chime when a transaction confirms, coins when a withdrawal lands, a drop each time another whole GNOT unlocks. One click in the footer mutes it, and reduced-motion settings are respected.
- **Wallets**: Adena, or a demo wallet (a throwaway key generated and kept in the browser) so a judge can try it with nothing installed. Fund the demo address from the [faucet](https://faucet.gno.land).

## Deployment

Both packages were submitted to `onyx-1` with `gnokey maketx addpkg` (transactions above). Onyx runs the `inert` code-submission policy: a submitted package is parked until the chain's package approver enables it. Check the state with:

```sh
gnokey query vm/qpkgmeta_json \
  -data gno.land/r/g1a04glq8w6ts7r9yzyznpa99qkzwp8pewcf3aef/trickle \
  -remote https://rpc.onyx.testnets.gno.land:443
```

`"status":"live"` means the realm is callable and its page is served at <https://onyx.testnets.gno.land/r/g1a04glq8w6ts7r9yzyznpa99qkzwp8pewcf3aef/trickle>.

## License

MIT
