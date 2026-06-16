# Getting started

## Install

The core is everything you need to define events and fold projections — no database required:

```sh
npm install @hilaryosborne/sourcing zod
```

Add the repository and a storage adapter only when you want events _persisted_ and projections kept up to date for you:

```sh
npm install @hilaryosborne/sourcing-persistence @hilaryosborne/sourcing-adapter-postgres
```

Core depends on exactly two packages (`zod`, `nanoid`). Each adapter is independently versioned — change one adapter, only it publishes.

::: info GitHub Packages auth (one-time)
These packages publish to GitHub Packages, which requires authentication to install **even though they are public**. Add a project `.npmrc`:

```ini
@hilaryosborne:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

and export a `GITHUB_TOKEN` (a personal access token with `read:packages`). This is a cost of GitHub Packages, not of the library.
:::

## Your first projection

Three primitives, three steps. This snippet runs as-is — no database, nothing to configure.

```ts
import { event, aggregate, projection } from "@hilaryosborne/sourcing";
import { object, string, number } from "zod";

// 1 — Events: a topic (opaque, versioned string) + a Zod payload schema.
const AccountOpened = event("account.opened.v1").version(object({ holder: string().min(1) }));
const Deposited = event("account.deposited.v1").version(object({ amount: number().int().positive() }));

// 2 — An aggregate: a name + the events that are legal on its stream.
const Account = aggregate("account.v1");
Account.register(AccountOpened);
Account.register(Deposited);

// 3 — A projection: a name, an output schema, and one handler per event.
//     `e.payload` is fully typed from the event's schema — no casts.
const Balance = projection("projection.balance.v1", object({ holder: string(), balance: number() }));
Balance.aggregate(Account);
Balance.handle(AccountOpened, (current, e) => ({ ...current, holder: e.payload.holder, balance: 0 }));
Balance.handle(Deposited, (current, e) => ({ ...current, balance: current.balance + e.payload.amount }));

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
Handlers receive a _complete_ `current: State` (not a `Partial`), which is what lets you write `current.balance` without `| undefined` everywhere. You uphold that by making your **creating event** (`account.opened.v1`) establish the whole shape. A projection whose first folded event doesn't produce a schema-valid state throws `OUTPUT_INVALID` — a runtime error the types couldn't catch. Rule of thumb: every stream starts with a `*.created`/`*.opened` event whose handler returns the full base; every other handler spreads `...current`. See [Projections](/guide/projections).
:::

## Where to next

- [The mental model](/concepts) — the three nouns and why the split between committed and staged matters.
- [The three scenarios](/guide/scenarios) — projections on demand, self-healing from storage, and staged validation.
- Deep dives: [Events](/guide/events) · [Aggregates](/guide/aggregates) · [Projections](/guide/projections) · [Storage adapters](/guide/storage-adapters).
