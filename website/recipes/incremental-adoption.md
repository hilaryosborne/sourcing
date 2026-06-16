# 🌱 Incremental adoption from CRUD

You don't have to rewrite your app to start. The core runs with no database and no repository, so you can fold events in _one corner_ of an existing CRUD system and grow from there. Nothing here is all-or-nothing.

## Step 1 — Fold events you already have (no storage)

If any part of your system already records changes — an `audit_log` table, a webhook history, an append-only column — you can derive a read model from it **today**, with just the core package and zero migration:

```ts
import { Account, Balance, AccountOpened, Deposited } from "./domain";

// rows you already store, turned into events in memory
const account = Account.instance(accountId);
for (const row of auditRows) {
  const e =
    row.kind === "opened" ? AccountOpened.create({ holder: row.holder }) : Deposited.create({ amount: row.amount });
  account.events.add(e.creator("user", row.actor));
}
account.events.commit();

const view = Balance.build(account); // a fresh read model, derived — no schema change
```

This is the lowest-risk way in: it touches nothing, stores nothing, and proves the model against your real data.

## Step 2 — Emit events alongside your writes (the strangler)

Next, have new writes record an event _as well as_ doing the existing CRUD update. Your tables stay the source of truth for now; the event stream grows in parallel, and you derive new read models from it whenever you want one:

```ts
async function deposit(accountId: string, amount: number, actor: string) {
  await db.accounts.increment(accountId, amount); // existing CRUD, unchanged
  await eventLog.append(Deposited.create({ amount }).creator("user", actor).build()); // also record the fact
}
```

Now a new dashboard is a [projection](/guide/projections) over the events, not a backfill migration against production.

## Step 3 — Backfill a stream from existing rows

To make an entity event-sourced from here on, synthesise its **creating event** from the current row — that single event establishes the projection's shape ([the first-event contract](/guide/projections)):

```ts
const seed = AccountOpened.create({ holder: row.holder, balance: row.balance }).creator("system", "backfill");
account.events.add(seed);
account.events.commit(); // the stream now starts from a faithful snapshot of today
```

From this point, append real events; the row becomes a cache you can eventually drop.

## Step 4 — Add the repository when you want it stored

When you want events durably stored and projections kept current for you, add `@hilaryosborne/sourcing-persistence` and an adapter — the _same_ domain code, now reading and writing through the [repository](/guide/repository). The projections you already wrote don't change.

```ts
const repo = repository({ storage: await postgresStorage(pgClient) });
const account = await repo.load(Account, accountId); // was: fill it by hand
await repo.commit(account);
const balance = await repo.rebuild({ aggregate: Account, id: accountId, projection: Balance });
```

The core can't tell whether _you_ filled the aggregate or the repository did — which is exactly what lets you move between these steps without rewriting your domain. ([Architecture →](/guide/architecture#the-three-ways-to-use-it))

## ➡️ Next

- [Quickstart](/guide/getting-started) — the core-only path in 60 seconds.
- [The repository & self-healing](/guide/repository) — step 4 in depth.
- [Common use cases](/guide/use-cases) — what each step unlocks.
