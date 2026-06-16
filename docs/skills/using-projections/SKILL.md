---
name: using-projections
description: >-
  How to BUILD projections (read-models) with the published @hilaryosborne/sourcing core —
  the `projection(name, schema)` factory, `aggregate` binding, typed `handle` mappers, and
  `build(aggregate, from?)` including the delta/resume seed. Covers the load-bearing
  "first-event-establishes-the-shape" contract and how to stay on the right side of it. Use
  when a consumer is designing a read-model, writing handlers, debugging an OUTPUT_INVALID
  error, or wiring the self-healing delta fold. Assumes sourcing-concepts. Companions:
  using-events, using-aggregates.
---

# Using projections

A projection is a **pure builder**: a name, an output Zod schema (the read-model shape), and one handler per event. `build()` folds the aggregate's events through the handlers and **validates the result against the schema on every build**. Projections hold no truth — bin and rebuild freely.

## Define a projection

```ts
import { projection } from "@hilaryosborne/sourcing";
import { object, string, number } from "zod";

const BalanceSchema = object({ holder: string(), balance: number() });

export const Balance = projection("balance", BalanceSchema);
Balance.aggregate(Account); // bind the aggregate this projection reads
Balance.handle<{ holder: string }>(AccountOpened, (current, e) => ({
  ...current,
  holder: e.payload.holder,
  balance: 0,
}));
Balance.handle<{ amount: number }>(AccountDeposited, (current, e) => ({
  ...current,
  balance: current.balance + e.payload.amount,
}));
Balance.handle<{ amount: number }>(AccountWithdrawn, (current, e) => ({
  ...current,
  balance: current.balance - e.payload.amount,
}));
```

- `projection<State>(name, schema)` — the **name is the projection's identity in the projection store** (stored projections are keyed by it). Make it stable and unique.
- `aggregate(def)` binds the aggregate; `handle` then rejects any event not registered on it (`ProjectionErrors.EVENT_UNREGISTERED`).
- `handle<P>(eventDef, mapper)` keys off the event **definition**, not a topic string. The event definition is no longer parameterized by payload (the ref-exact builder leaves the handle untyped), so **annotate the payload type** — `handle<{ holder: string }>(…)` — to type `e.payload`; without it the mapper sees `unknown` (still runtime-validated by the event's schema on read). The mapper is `(current: State, event: TypedEvent<P>) => State`. Registering two handlers for one topic throws `ProjectionErrors.TOPIC_DUPLICATE`.

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
delta.events.add(AccountWithdrawn.create({ amount: 30 }).creator("user", "ada"));
Balance.build(delta, { holder: "Ada", balance: 100 }); // → { holder: "Ada", balance: 70 }
```

(With the repository you don't call this by hand — `repo.rebuild` does the delta fold for you. You write the same handlers either way.)

## The load-bearing contract: the first folded event establishes the shape

There is **no separate `initial` seed.** Handlers are typed with a _complete_ `current: State` (not `Partial`), which is what lets you write `current.balance` without `| undefined` friction everywhere. You uphold that by **seeding the entire model shape in your creating event's handler**:

```ts
// ✅ the creating handler establishes EVERY field the schema requires
Balance.handle<{ holder: string }>(AccountOpened, (current, e) => ({
  ...current,
  holder: e.payload.holder,
  balance: 0,
}));
```

Break the promise and you get a runtime error the types couldn't catch:

```ts
// ❌ a projection whose first folded event is a non-creating event
const bad = projection("bad", BalanceSchema).aggregate(Account);
bad.handle<{ amount: number }>(AccountWithdrawn, (c, e) => ({ ...c, balance: c.balance - e.payload.amount }));
const a = Account.instance();
a.events.add(AccountWithdrawn.create({ amount: 5 }).creator("user", "x"));
bad.build(a); // throws ProjectionErrors.OUTPUT_INVALID — `holder` was never established
```

**Rule of thumb:** every stream starts with a `*.created`/`*.opened` event whose handler returns the full schema-valid base. Every other handler spreads `...current` and changes only what it owns.

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
