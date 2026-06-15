# DOCS.md — Using the library (one worked domain, all three scenarios)

This is the consumer's view: how an application _uses_ the library, not how it is built
internally. It carries **one domain across all three scenarios** from FOUNDATION.md, end to
end. For the _why_ behind the shapes, read the [**concepts skill**](docs/skills/sourcing-concepts/SKILL.md)
first; for a fast start, the [**README**](README.md); for per-part how-to, the component
skills under [`docs/skills/`](docs/skills/). Every shape below is implemented, tested, and
proven against real services.

---

## How the library is layered

Three layers, each depending only on the one before it:

- **The aggregate (core).** Holds a stream of events for one id, keeping _committed_ events
  (the durable history) apart from _staged_ ones (proposed, not yet committed). It has **no
  dependency on storage** — it does not fetch, store, or know where events come from.
- **The repository (persistence layer).** Decides what to fetch and what to store: it reads
  events, composes them into an aggregate, builds projections, and persists results. It is
  optional and lives _outside_ core, composed on top of it.
- **The storage adapter.** The swappable persistence implementation — Postgres, Mongo, S3.
  The repository talks to it through one interface; the aggregate never sees it.

| Package                                               | Role                                                      | You install it when…                 |
| ----------------------------------------------------- | --------------------------------------------------------- | ------------------------------------ |
| `@hilaryosborne/sourcing`                             | core — events, aggregates, projections, strippers         | always                               |
| `@hilaryosborne/sourcing-persistence`                 | the repository — registry, projection store, self-healing | you want Scenario 2 (storage-backed) |
| `@hilaryosborne/sourcing-adapter-{postgres,mongo,s3}` | a storage adapter                                         | you pick where events live           |

Scenario 1 and Scenario 3 need **core only** — no database, no repository.

---

## Defining your domain (core)

A tiny bank account is used throughout: deposits add, withdrawals subtract, and a
withdrawal must never overdraw — the classic case for _staged_ validation.

### Events — immutable, past-tense facts

```ts
import { event } from "@hilaryosborne/sourcing";
import { object, string, number } from "zod";

export const AccountOpenedV1 = event("account.opened.v1", object({ holder: string().min(1) }));
export const AccountDepositedV1 = event("account.deposited.v1", object({ amount: number().int().positive() }));
export const AccountWithdrawnV1 = event("account.withdrawn.v1", object({ amount: number().int().positive() }));
```

The topic (`"account.opened.v1"`) is an opaque unique string. The library never parses it
and never relates `.v1` to `.v2` — **versioning is a convention in the string**, not a feature.

Events are **standalone**. An event definition is built on its own and is not bound to any
one aggregate — the _same_ event may be registered on many aggregates (topic uniqueness is
per-aggregate, never global). You construct an event instance fluently and add it to an
aggregate later:

```ts
const opened = AccountOpenedV1.create({ holder: "Ada" }).creator("user", "ada").headers({ source: "import" });
// → a standalone event builder; position + aggregate reference are stamped when it is added
```

`create()` validates the payload immediately (fail fast). `creator` is **required** — a
permanent fact with bogus provenance is worse than one that refuses to be created; `headers`
are optional decoration.

#### Strippers — the right-to-forget capability

An event definition can register **named, contextual** redactions, declared next to the
event they erase. Strippers are pure: payload in, redacted payload out.

```ts
AccountOpenedV1.strip("gdpr", (payload) => ({ ...payload, holder: "[redacted]" }));
```

### The aggregate

Name it, then register the events that are legal on it. An aggregate is a _composition of
allowed events_ — and because events are standalone, the same event definition can be
registered on more than one aggregate.

```ts
import { aggregate } from "@hilaryosborne/sourcing";

export const Account = aggregate("account.v1");
Account.register(AccountOpenedV1);
Account.register(AccountDepositedV1);
Account.register(AccountWithdrawnV1);
```

An aggregate _instance_ exposes its identity as plain properties (`account.id`,
`account.name`, `account.position`) and groups all event operations under `account.events`:
`add` (stage a new event), `import` (load history), `export` (dump envelopes), `commit`
(fold pending into history), and the two event sets — `committed` (the durable history) and
`staged` (pending, not yet committed).

### The projection — a pure builder

Name it, give it an output schema, bind the aggregate it reads, then register a handler per
event. Each handler receives the **typed** event — its payload is known from the event
definition — and returns the next state. `build` folds the handlers and validates the result
against the schema on **every** build.

```ts
import { projection } from "@hilaryosborne/sourcing";
import { object, string, number } from "zod";

const BalanceV1 = object({ holder: string(), balance: number() });

export const Balance = projection("projection.balance.v1", BalanceV1);
Balance.aggregate(Account);

Balance.handle(AccountOpenedV1, (current, event) => ({ ...current, holder: event.payload.holder, balance: 0 }));
Balance.handle(AccountDepositedV1, (current, event) => ({
  ...current,
  balance: current.balance + event.payload.amount,
}));
Balance.handle(AccountWithdrawnV1, (current, event) => ({
  ...current,
  balance: current.balance - event.payload.amount,
}));
```

`handle()` takes the event _definition_ (not a topic string), so `event.payload` is fully
typed, and binding `aggregate()` lets it reject an event the aggregate doesn't know. The
projection's **name** is its identity in the projection store (Scenario 2).

> **Contract — the first folded event establishes the shape.** There is no separate
> `initial` seed in the definition. The handler signature **promises a complete `current`**
> (it is typed as the full model, not `Partial`) — you keep that promise by seeding the full
> shape in your _creating_ event (here, `AccountOpenedV1`); every handler then defensively
> spreads `...current`. Break the promise — a first folded event that doesn't establish the
> shape — and you get a **runtime validation error the types won't catch**. That sharp edge
> is the price of the ergonomic default (no `current.balance | undefined` friction
> everywhere). The starting state for a _resumed_ build is the optional second argument to
> `build(aggregate, from?)` (the stale path in Scenario 2), not baked into the definition.

---

## Scenario 1 — Projections on demand (core only)

Build events, fold a projection, read the result. Nothing is stored.

```ts
const account = Account.instance(); // core mints a fresh id (a nanoid); pass one to override
account.events.add(AccountOpenedV1.create({ holder: "Ada" }).creator("user", "ada"));
account.events.add(AccountDepositedV1.create({ amount: 100 }).creator("user", "ada"));
account.events.commit(); // in-memory: fold staged → committed (no persistence — core has none)

const state = Balance.build(account);
// → { holder: "Ada", balance: 100 }
```

You build each event standalone and hand it to the aggregate with `events.add()`, which
stamps its provisional position and aggregate reference and drops it on `staged`. `commit()`
folds `staged` into `committed`. Nothing leaves memory — core has no storage.

---

## Scenario 3 — Staged events & business validation (core only)

This is the committed/staged split doing its job: preview the _would-be_ state of an
uncommitted event, judge it, and only then commit. **The library answers "what would the
state be?" — your app answers "is this allowed?"**

```ts
const account = Account.instance("acc-1");
account.events.import(history); // loaded history → committed, balance = 100

account.events.add(AccountWithdrawnV1.create({ amount: 250 }).creator("user", "ada")); // staged, NOT committed

const wouldBe = Balance.build(account); // folds committed ++ staged

if (wouldBe.balance < 0) {
  // Business rule violated. Reject. Never commit. The staged event evaporates.
} else {
  account.events.commit();
}
```

No business logic lives in the library. The overdraw rule is entirely your app's; the
library just told you the projected balance would be `-150`.

---

## Scenario 2 — Projections from storage (self-healing)

Now we bring in the persistence layer and a storage adapter. The repository is composed once
from an adapter; the registry and projection store are its internal collaborators.

```ts
import { repository } from "@hilaryosborne/sourcing-persistence";
import { postgresStorage } from "@hilaryosborne/sourcing-adapter-postgres";

// Adapters take a thin CLIENT PORT over your real driver, plus optional destinations.
// See the using-storage-adapters skill for the full pgClient/mongoClient/s3Client wiring.
const storage = await postgresStorage(pgClient, { events: "account_events", projections: "account_projections" });
const repo = repository({ storage }); // auto-wires the registry + projection store from the one adapter
```

### Write path — build events, let the repository persist them

```ts
// open a new account — id is minted by core (a nanoid), not by storage
const opening = await repo.create(Account);
opening.events.add(AccountOpenedV1.create({ holder: "Ada" }).creator("user", "ada"));
opening.events.add(AccountDepositedV1.create({ amount: 100 }).creator("user", "ada"));
await repo.commit(opening); // append staged events + advance the registry head
const id = opening.id;

// later: append to an existing aggregate
const account = await repo.load(Account, id); // hydrate history (→ committed) from storage
account.events.add(AccountWithdrawnV1.create({ amount: 30 }).creator("user", "ada"));
await repo.commit(account);
```

`create`/`load` → `events.add` → `commit` is the storage-backed counterpart of Scenario 3:
the same aggregate, you can still preview before committing, and the repository never judges
your events. **Ids are minted by core** (the same nanoid mechanism events get), so an
aggregate's id is knowable without touching a database — Scenario 1 depends on that. A
storage adapter _may_ override id generation if it has a reason, but that is the exception,
not the default.

### Read path — self-healing

```ts
const balance = await repo.rebuild({
  aggregate: Account,
  id,
  projection: Balance, // the projection's own name is its storage key
});
```

One cheap registry read (`aggregate id → current head position`) decides among three outcomes:

| Stored projection vs. registry head | What the repository does                                                                 |
| ----------------------------------- | ---------------------------------------------------------------------------------------- |
| **no stored projection**            | read the full stream, build from the first event, save                                   |
| **head > bookmark** (stale)         | read **only the delta** (events after the bookmark), fold it over the stored state, save |
| **head === bookmark** (current)     | return the stored state as-is — **no event fetch** (the cheap win)                       |

The stale path is the reason the projection builder takes a _starting state_: the repository
imports only the delta into a fresh aggregate and folds it over the stored projection state,
instead of replaying from the first event.

### Scenario 3, but storage-backed

The same overlay works on stored data — load, stage a not-yet-committed event, preview,
discard or commit:

```ts
const account = await repo.load(Account, id);
account.events.add(AccountWithdrawnV1.create({ amount: 250 }).creator("user", "ada"));
const wouldBe = Balance.build(account);
// judge wouldBe.balance; commit via repo.commit(account) only if your rules pass
```

---

## Right-to-forget, end to end

Because projections are pure derivations, erasure is: **strip the events → overwrite them →
rebuild the projections.** That sequence has a sharp ordering (skip the rebuild and PII
survives in a stale projection), so the repository owns it as a first-class operation:

```ts
await repo.forget({ aggregate: Account, id, context: "gdpr" });
// the repository: load the full stream → strip("gdpr") → overwrite events in place → rebuild projections
```

The app owns the _decision_ to forget; the repository owns the _mechanism_ to erase
correctly. No judgment moves into the library — only the know-how.

Pure-core, without any persistence:

```ts
const redacted = account.strip("gdpr"); // a NEW aggregate: same ids, positions, topics; payloads redacted
redacted.events.export(); // PII-free envelopes — the pass/fail test is that no PII survives
```

The library appends **no** "redaction happened" marker. If you want an erasure audit trail,
emit your own event — that's a business concern.

---

## Storage is swappable — and may be spread

Every adapter implements one storage interface (`StorageI`). Swapping backends is changing one
import and one factory call — the rest of your code is untouched:

```ts
import { mongoStorage } from "@hilaryosborne/sourcing-adapter-mongo";
const storage = await mongoStorage(mongoClient, { events: "account_events", projections: "account_projections" });
const repo = repository({ storage });
```

Each adapter is wired by injecting a small **client port** over your driver (`pg`, `mongodb`,
`@aws-sdk/client-s3`) — the [**using-storage-adapters skill**](docs/skills/using-storage-adapters/SKILL.md)
gives the exact port for each, plus the operational preconditions (Mongo needs a replica set;
the `(stream, position)` unique index is the compare-and-append).

Storage can be anything: a single database, duplicated stores, or one aggregate's data spread
across several databases/technologies, routed however the adapter likes. The repository and
the aggregate never know or care. The one operation that pressure-tests an adapter is
**overwrite** (right-to-forget): trivial in Postgres/Mongo, expensive in S3 (it rewrites
whichever object holds the event).

---

## Where to go next

Every shape on this page is implemented, tested, and proven — core (Epic 3) against its unit
suite, the repository and all three adapters (Epic 4) against **real Postgres, a Mongo replica
set, and MinIO** via a shared conformance suite run in CI.

- **The why** — [docs/skills/sourcing-concepts](docs/skills/sourcing-concepts/SKILL.md): the
  mental model behind every shape here.
- **Per-part how-to** — [using-events](docs/skills/using-events/SKILL.md) ·
  [using-aggregates](docs/skills/using-aggregates/SKILL.md) ·
  [using-projections](docs/skills/using-projections/SKILL.md) ·
  [using-storage-adapters](docs/skills/using-storage-adapters/SKILL.md): exact signatures,
  the full error tables, and the real driver wiring for each adapter.
- **The rulings** — [FOUNDATION.md](FOUNDATION.md): the architecture and the decisions behind it.
