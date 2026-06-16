# 🏁 Quickstart

## Install

The core is all you need for this — no database:

```sh
npm install @hilaryosborne/sourcing zod
```

These packages live on GitHub Packages, so installing needs a one-time `.npmrc` + token. [Installation & setup](/guide/installation) has those two lines plus everything else — storage adapters and local databases for when you're ready.

## Your first projection

Three primitives, three steps. This snippet runs as-is — no database, nothing to configure.

```ts
import { event, aggregate, projection } from "@hilaryosborne/sourcing";
import { object, string, number } from "zod";

// 1 — Events: a topic (opaque, versioned string) + a Zod payload schema, declared as the first version.
const AccountOpened = event("account.opened");
AccountOpened.version(1, object({ holder: string().min(1) }));
const Deposited = event("account.deposited");
Deposited.version(1, object({ amount: number().int().positive() }));

// 2 — An aggregate: a name + the events that are legal on its stream.
const Account = aggregate("account");
Account.register(AccountOpened);
Account.register(Deposited);

// 3 — A projection: a name, an output schema, and one handler per event.
//     Annotate the payload type on handle() to type `e.payload`; it's runtime-validated either way.
const Balance = projection("balance", object({ holder: string(), balance: number() }));
Balance.aggregate(Account);
Balance.handle<{ holder: string }>(AccountOpened, (current, e) => ({
  ...current,
  holder: e.payload.holder,
  balance: 0,
}));
Balance.handle<{ amount: number }>(Deposited, (current, e) => ({
  ...current,
  balance: current.balance + e.payload.amount,
}));

// Build some facts and fold them. Nothing is stored — this is pure, in-memory.
const account = Account.instance(); // core mints a nanoid id; pass your own to override
account.events.add(AccountOpened.create({ holder: "Ada" }).creator("user", "ada"));
account.events.add(Deposited.create({ amount: 100 }).creator("user", "ada"));
account.events.commit();

Balance.build(account); // → { holder: "Ada", balance: 100 }
```

Three things worth knowing up front:

- **`create()` validates immediately.** A payload that fails its schema throws right there — facts are never half-formed.
- **`creator` is required; `headers` are optional.** A permanent fact with no provenance refuses to be created (there is no default). Headers are opaque decoration the library never reads.
- **`commit()` here is in-memory only** — it folds staged events into committed history. Core has no storage; durability is the repository's job (see [Storage adapters](/guide/storage-adapters)).

::: warning The one sharp edge — projections have no `initial` seed
Handlers receive a _complete_ `current: State` (not a `Partial`), which is what lets you write `current.balance` without `| undefined` everywhere. You uphold that by making your **creating event** (`account.opened`) establish the whole shape. A projection whose first folded event doesn't produce a schema-valid state throws `OUTPUT_INVALID` — a runtime error the types couldn't catch. Rule of thumb: every stream starts with a `*.created`/`*.opened` event whose handler returns the full base; every other handler spreads `...current`. See [Projections](/guide/projections).
:::

## Run it

Drop the snippet into a file and run it with [`tsx`](https://github.com/privatenumber/tsx) — no build step, no services:

```sh
npx tsx first-projection.ts   # → { holder: "Ada", balance: 100 }
```

The core is pure and in-memory, so it runs anywhere Node does. (It installs from GitHub Packages, so make sure your `.npmrc` + token are set — see [Installation](/guide/installation).)

## Where to next

- [Architecture at a glance](/guide/architecture) — the three layers, and how a write and a read flow through them.
- [The mental model](/concepts) — the three nouns and why the split between committed and staged matters.
- [Common use cases](/guide/use-cases) — what you'll build, and the doubts (right-to-forget, your own logger, versioning, concurrency) answered head-on.
- Deep dives: [Events](/guide/events) · [Aggregates](/guide/aggregates) · [Projections](/guide/projections) · [Storage adapters](/guide/storage-adapters).
