# Trickle: DoraHacks BUIDL text

Copy for the Gnome Tavern submission form.

## Name

Trickle

## One-line description

Per-second GNOT payment streams on Gno.land: salaries, grants and vesting that unlock continuously and can be withdrawn at any moment.

## Short description

Trickle lets anyone lock GNOT once and have it unlock for a recipient every second. The recipient withdraws whenever they like. If the sender cancels, the recipient keeps everything unlocked so far and only the unearned part is refunded, in the same transaction. Streams can have a cliff, can be made non-cancelable for vesting, can be transferred by the recipient, and up to 50 can be opened in one payroll transaction.

## What was built

- **`p/trickle`**, a reusable accounting package. It holds no coins and never reads the clock, so any realm can reuse it to stream GRC20 tokens or points. It keeps `Withdrawn + Withdrawable + Refundable == Deposit` at every instant and uses 128-bit math so no deposit can overflow.
- **`r/trickle`**, the realm that escrows GNOT. Create, batch create, withdraw, cancel, transfer; paginated JSON queries for apps; events for indexers; and gnoweb pages with progress bars and action links, so the protocol is usable with no frontend at all.
- **A web app** with balances that tick live, plain-language summaries before signing, Adena support, and a built-in demo wallet so a judge can try it without installing anything.

## Why it matters for Gno.land

Payments on Gno.land today are one-off transfers. Streaming turns "pay 3,000 GNOT at the end of the month and trust me" into "earn it every second, leave any time with what you earned". DAOs paying contributors, grant programs releasing funds over a milestone period, and teams vesting tokens all need this primitive, and the package is written so other realms can build on it rather than rewrite it.

## Technical highlights

- Payment checks follow the Gno security guide: `cur.Previous().IsUserCall()` before reading the origin send, exactly one `ugnot` coin. A test proves a wrapper realm cannot call `Create`.
- Solvency is tested: the realm's balance always covers what streams still owe.
- Recipients must be canonical addresses, so a stream can never be locked to a spelling nobody can sign for.
- `Render` treats every path and memo as hostile input and sanitizes it.
- Package and realm tests run in CI on every push.

## Links

- Repository: https://github.com/Shijas786/trickle
- Realm on Onyx testnet: https://onyx.testnets.gno.land/r/g1a04glq8w6ts7r9yzyznpa99qkzwp8pewcf3aef/trickle
- Realm path: `gno.land/r/g1a04glq8w6ts7r9yzyznpa99qkzwp8pewcf3aef/trickle`
- Package path: `gno.land/p/g1a04glq8w6ts7r9yzyznpa99qkzwp8pewcf3aef/trickle`
