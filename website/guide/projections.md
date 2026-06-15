# Projections

A projection is a **pure builder**: a name, an output Zod schema (the read-model shape), and one handler per event. `build()` folds an aggregate's events through the handlers and **validates the result against the schema on every build**. Projections hold no truth — bin and rebuild them freely.

If you are new to how events, aggregates, and projections fit together, start with the [mental model](/concepts).

## Define a projection

```ts
import { projection } from "@hilaryosborne/sourcing";
import { object, string, number } from "zod";

const BalanceV1 = object({ holder: string(), balance: number() });

export const Balance = projection("projection.balance.v1", BalanceV1);
Balance.aggregate(Account); // bind the aggregate this projection reads
Balance.handle(AccountOpenedV1, (current, e) => ({ ...current, holder: e.payload.holder, balance: 0 }));
Balance.handle(AccountDepositedV1, (current, e) => ({ ...current, balance: current.balance + e.payload.amount }));
Balance.handle(AccountWithdrawnV1, (current, e) => ({ ...current, balance: current.balance - e.payload.amount }));
```

- `projection<State>(name, schema)` — the **name is the projection's identity in the projection store** (stored projections are keyed by it). Make it stable and unique.
- `aggregate(def)` binds the aggregate; `handle` then rejects any event not registered on it (`ProjectionErrors.EVENT_UNREGISTERED`).
- `handle(eventDef, mapper)` keys off the event **definition**, not a topic string — so `e.payload` is **fully typed** to that event's schema. The mapper is `(current: State, event: TypedEvent<P>) => State`. Registering two handlers for one topic throws `ProjectionErrors.TOPIC_DUPLICATE`.

See [Events](/guide/events) and [Aggregates](/guide/aggregates) for the definitions a projection reads.

## Build

```ts
const state = Balance.build(account); // → { holder: "Ada", balance: 100 }
```

`build(aggregate, from?)` folds `committed ++ staged` in position order, then `schema.parse`es the result:

- **Omit `from`** → a full build from the first event.
- **Pass `from`** (a prior state) → **resume**: fold only the events in the aggregate _over_ that seed. This is what the self-healing stale path uses — import just the delta, fold over the stored projection state, skip replaying history.

```ts
// the stale-path shape: only the delta is in the aggregate, the stored state seeds the fold
const delta = Account.instance("acc-1");
delta.events.add(AccountWithdrawnV1.create({ amount: 30 }).creator("user", "ada"));
Balance.build(delta, { holder: "Ada", balance: 100 }); // → { holder: "Ada", balance: 70 }
```

When you use a [storage adapter](/guide/storage-adapters), you don't call this by hand — the repository's `rebuild` does the delta fold for you. You write the same handlers either way.

## The load-bearing contract: the first folded event establishes the shape

There is **no separate `initial` seed.** Handlers are typed with a _complete_ `current: State` (not `Partial`), which is what lets you write `current.balance` without `| undefined` friction everywhere. You uphold that by **seeding the entire model shape in your creating event's handler**:

```ts
// ✅ the creating handler establishes EVERY field the schema requires
Balance.handle(AccountOpenedV1, (current, e) => ({ ...current, holder: e.payload.holder, balance: 0 }));
```

Break the promise and you get a runtime error the types couldn't catch:

```ts
// ❌ a projection whose first folded event is a non-creating event
const bad = projection("projection.bad.v1", BalanceV1).aggregate(Account);
bad.handle(AccountWithdrawnV1, (c, e) => ({ ...c, balance: c.balance - e.payload.amount }));
const a = Account.instance();
a.events.add(AccountWithdrawnV1.create({ amount: 5 }).creator("user", "x"));
bad.build(a); // throws ProjectionErrors.OUTPUT_INVALID — `holder` was never established
```

::: warning The first folded event establishes the shape
Every stream must start with a `*.created`/`*.opened` event whose handler returns the full schema-valid base. Every other handler spreads `...current` and changes only what it owns. If the first folded event is a non-creating event, the model is missing required fields and `build` throws `ProjectionErrors.OUTPUT_INVALID` — and the types can't catch it for you.
:::

## Errors projections raise (all mechanical)

| Error                                 | When                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------- |
| `ProjectionErrors.OUTPUT_INVALID`     | The folded state failed the output schema (checked on **every** build).   |
| `ProjectionErrors.TOPIC_DUPLICATE`    | Two handlers registered for the same topic in one projection.             |
| `ProjectionErrors.MAPPER_INVALID`     | A structurally malformed `handle()` (missing definition or non-function). |
| `ProjectionErrors.EVENT_UNREGISTERED` | `handle()` got an event not registered on the bound aggregate.            |

## Gotchas

- **`OUTPUT_INVALID` usually means a shape gap, not bad data** — most often a first-event-doesn't-seed-the-shape mistake, or a handler that dropped a required field by not spreading `...current`.
- **Unmapped topics are tolerated.** `build` folds events it has handlers for and skips the rest — a projection need not handle every event on the aggregate.
- **Right-to-forget needs no per-projection work.** Because projections are pure derivations, once underlying events are stripped you just rebuild — the PII is gone from the read side automatically.
- **The name is a storage key.** Renaming a projection orphans its stored copy; treat the name as stable identity.
