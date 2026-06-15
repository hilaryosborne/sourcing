# sourcing

[![Docs](https://img.shields.io/badge/docs-hilaryosborne.github.io%2Fsourcing-3c8772?style=flat-square)](https://hilaryosborne.github.io/sourcing/) [![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](#license) [![Types: TypeScript](https://img.shields.io/badge/types-TypeScript-3178c6?style=flat-square)](https://www.typescriptlang.org/) [![Core deps: 2](https://img.shields.io/badge/core%20deps-zod%20%2B%20nanoid-success?style=flat-square)](#packages)

**An event sourcing library that records facts and derives state from them — and refuses to do anything else.** No business rules, no command layer, no opinion about where your data lives. You define events, fold them into read models, and decide what's allowed in your own code. The library never decides for you.

> 📖 **Full documentation, guides, and worked examples → [hilaryosborne.github.io/sourcing](https://hilaryosborne.github.io/sourcing/)**

```ts
// an event is a topic + a typed payload
const AccountOpened = event("account.opened.v1", object({ holder: string() }));
const Deposited = event("account.deposited.v1", object({ amount: number().int().positive() }));

// a projection folds events into a read model
const Balance = projection("projection.balance.v1", object({ holder: string(), balance: number() }));
Balance.handle(AccountOpened, (s, e) => ({ ...s, holder: e.payload.holder, balance: 0 }));
Balance.handle(Deposited, (s, e) => ({ ...s, balance: s.balance + e.payload.amount }));

Balance.build(account); // → { holder: "Ada", balance: 100 }
```

---

## Why this exists

Most applications store the _current_ state of a thing: one row per account, overwritten on every change. That row is lossy by construction — the moment a balance goes from 100 to 70, _why_ it changed is gone. Event sourcing inverts that: you store the **sequence of facts** that happened (`opened`, `deposited 100`, `withdrew 30`) and treat current state as a _fold_ over those facts. Nothing is overwritten; the history _is_ the database. You get a perfect audit trail, the ability to derive new read models retroactively from data you already have, and time-travel debugging for free.

The catch is that event sourcing libraries tend to do **too much**. They ship a "decider" or command-handler layer that wants to own your business rules; they bake in an event store; they carry upcaster machinery for versioning. You adopt the pattern and inherit a framework.

This library is the opposite bet. It is **mechanism, not judgment** — a deliberately small set of primitives:

- **It owns** events (with right-to-forget stripping), the aggregate (a container that keeps committed history apart from staged proposals), the projection builder, and — in a separate optional layer — a self-healing repository over swappable storage.
- **It does not own** your business rules. There is no command/decider/validation layer. The aggregate enforces _no_ invariants and cannot reject an event for being "not allowed." You stage an event, ask the library _"what would the state be if this were real?"_, and judge the answer in your own code. The library never learns what your rule was.
- **It has no opinion on storage.** The core has zero storage dependencies — it never reaches a database. Persistence is a separate package you add only when you want it, behind one interface with three reference adapters (Postgres, Mongo, S3) or your own.
- **The only errors it raises are mechanical** — a payload that fails its schema, a malformed projection mapper, a topic collision, a lost optimistic-concurrency race. It will never say "insufficient funds." That sentence is yours to write.

A few deliberate stances that distinguish it (each explained in the [FAQ](#faq)): **versioning is a naming convention, not a feature** (`file.create.v1` is an opaque string — no upcasters, no migration engine); **right-to-forget is built in** via in-place stripping; and **the committed/staged split** is what lets you do business validation without the library ever knowing what validation is.

> **When you should _not_ reach for this:** if you only ever need the latest state and will never ask "how did it get this way?", event sourcing is overhead you don't need — use a row in a table. See ["Do I actually need event sourcing?"](#do-i-actually-need-event-sourcing) before adopting.

---

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

<details>
<summary><strong>GitHub Packages auth (one-time)</strong></summary>

These packages publish to GitHub Packages, which requires authentication to install **even though they are public**. Add a project `.npmrc`:

```ini
@hilaryosborne:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

and export a `GITHUB_TOKEN` (a personal access token with `read:packages`). This is a cost of GitHub Packages, not of the library.

</details>

---

## Getting started

Three primitives, three steps. This snippet runs as-is — no database, nothing to configure.

```ts
import { event, aggregate, projection } from "@hilaryosborne/sourcing";
import { object, string, number } from "zod";

// 1 — Events: a topic (opaque, versioned string) + a Zod payload schema.
const AccountOpened = event("account.opened.v1", object({ holder: string().min(1) }));
const Deposited = event("account.deposited.v1", object({ amount: number().int().positive() }));

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

What just happened, and the three things worth knowing up front:

- **`create()` validates immediately.** A payload that fails its schema throws right there — facts are never half-formed.
- **`creator` is required; `headers` are optional.** A permanent fact with no provenance refuses to be created (there is no default). Headers are opaque decoration the library never reads.
- **`commit()` here is in-memory only** — it folds staged events into committed history. Core has no storage; durability is the repository's job (below).

> **The one sharp edge — projections have no separate `initial` seed.** Handlers receive a _complete_ `current: State` (not a `Partial`), which is what lets you write `current.balance` without `| undefined` everywhere. You uphold that by making your **creating event** (`account.opened.v1`) establish the whole shape. A projection whose first folded event doesn't produce a schema-valid state throws `OUTPUT_INVALID` — a runtime error the types couldn't catch. Rule of thumb: every stream starts with a `*.created`/`*.opened` event whose handler returns the full base; every other handler spreads `...current`.

---

## The mental model

Keep three nouns straight and the rest follows. Dependency flows one way: **adapter ← repository ← core**.

- **The aggregate (core).** An in-memory container for one entity's event stream. It keeps **committed** events (durable history) apart from **staged** ones (proposed, not yet committed). It holds events; it does not fetch, store, or judge them. It is _not_ a consistency boundary and enforces _no_ rules — deliberately a faithful container, nothing more.
- **The repository (persistence layer).** Optional. Decides what to read and write, composes events into an aggregate, builds and caches projections, and heals stale ones. The only thing that touches storage.
- **The storage adapter.** The swappable backend — Postgres, Mongo, S3, or yours. The repository talks to it through one interface; the aggregate never knows it exists.

The committed/staged split is the load-bearing idea. It's what powers business validation (next section) and self-healing (the section after). Everything else is detail.

---

## Common use cases

The same aggregate and projection builder serve every scenario. Only **who fills the aggregate** changes — and the library can't tell the difference, which is the whole point.

### Business validation without the library knowing your rules

Stage an event _without committing_, build the would-be projection, and judge it yourself. The library answers _"what would the state be?"_; your app answers _"is this allowed?"_.

```ts
account.events.add(Withdrawn.create({ amount: 250 }).creator("user", "ada")); // staged, NOT committed

const wouldBe = Balance.build(account); // folds committed ++ staged → balance -150
if (wouldBe.balance < 0) {
  // your overdraw rule. Reject — never commit. The staged event evaporates.
} else {
  account.events.commit();
}
```

There is no decider, no command bus, no rule engine to configure. The overdraw rule lives in an `if` statement in your code, exactly where you can read it.

### Persisted, self-healing projections

Add the repository and an adapter. Write through `commit`, read through `rebuild` — which keeps the stored projection current without you tracking what's stale.

```ts
import { repository } from "@hilaryosborne/sourcing-persistence";
import { postgresStorage } from "@hilaryosborne/sourcing-adapter-postgres";

// adapters take a thin CLIENT PORT over your driver (see "Wiring an adapter" below)
const storage = await postgresStorage(pgClient, { events: "account_events", projections: "account_projections" });
const repo = repository({ storage });

const opening = await repo.create(Account);
opening.events.add(AccountOpened.create({ holder: "Ada" }).creator("user", "ada"));
await repo.commit(opening); // append staged events, advance the head

const balance = await repo.rebuild({ aggregate: Account, id: opening.id, projection: Balance });
```

`rebuild` makes **one cheap head read** and takes the cheapest correct path:

| Stored projection vs. stream head | What happens                                                  |
| --------------------------------- | ------------------------------------------------------------- |
| **none**                          | read the full stream, build from scratch, save                |
| **head > bookmark** (stale)       | read **only the delta**, fold it over the stored state, save  |
| **head == bookmark** (current)    | return the stored state — **no event fetch** (the cheap path) |

Because projections are pure folds, they hold no independent truth: bin them and rebuild any time. That property is also what makes right-to-forget tractable.

### Wiring an adapter

Adapters don't take a connection string — they take a small **client port** you implement over your real driver, so the library never pins a driver version. Postgres needs one method:

```ts
import { Pool } from "pg";
import { postgresStorage, type PgClientPort } from "@hilaryosborne/sourcing-adapter-postgres";

const pool = new Pool({ host, port, user, password, database });
const pgClient: PgClientPort = {
  query: async (sql, params) => {
    const res = await pool.query(sql, params ? [...params] : undefined);
    return { rows: res.rows, rowCount: res.rowCount ?? 0 };
  },
};

const storage = await postgresStorage(pgClient, { events: "account_events", projections: "account_projections" });
```

The adapter creates its tables and the `(stream, position)` unique index at construction — that index _is_ the compare-and-append. Mongo and S3 follow the same shape with their own ports; full wiring (including Mongo's replica-set requirement and S3's etag-CAS) is in the [storage-adapters skill](docs/skills/using-storage-adapters/SKILL.md).

---

## Right-to-forget

Immutable history and "delete my data" sound like fire and water. The library reconciles them with **stripping**: each event declares named, contextual redactions next to itself (only the event understands its own payload), and erasure rewrites the affected events _in place_ with redacted payloads — same id, position, topic, and metadata, new payload. Nothing is mutated where it sits; a new redacted version replaces the old fact.

```ts
AccountOpened.strip("gdpr", (payload) => ({ ...payload, holder: "[redacted]" }));
```

Pure-core, erasure is `strip → export`, and the pass/fail test is blunt — **no PII survives in the produced events**:

```ts
const redacted = account.strip("gdpr"); // a NEW aggregate; events with no matching stripper pass through
redacted.events.export(); // PII-free envelopes
```

With storage, the repository owns the whole sharp-edged sequence as one operation:

```ts
await repo.forget({ aggregate: Account, id, context: "gdpr" });
// load the full stream → strip(context) → overwrite events in place → bin every projection for the stream
```

Binning projections is load-bearing, not housekeeping: in-place redaction doesn't move the stream head, so a cached "current" projection would still serve the old PII. Deleting it forces a clean rebuild from the redacted events.

> **`forget` is idempotent and convergent, but not atomic — completion is an operational obligation.** If it fails after overwriting events but before binning projections, PII can linger in a cached projection. Re-run it until it succeeds; re-running is always safe (stripping a redacted payload is a no-op). For a compliance operation, treat completion as required, not best-effort.

The library appends **no** "redaction happened" marker. If you want an erasure audit trail, emit your own event — that's a business fact, and business facts are yours.

---

## Observability

The repository is silent by default and exposes one optional **`observer`** — the seam you implement to wire it into your platform. It has three independent channels; implement only the ones you need:

```ts
import { repository, consoleObserver } from "@hilaryosborne/sourcing-persistence";

const repo = repository({
  storage,
  observer: {
    // logging (Splunk-shaped): leveled, structured events — pre/success at debug, failure at error
    logger: { info: splunk.send, warn: splunk.send, error: splunk.send, debug: splunk.send },
    // error reporting (New Relic-shaped): the actual Error object + context
    report: (r) => newrelic.noticeError(r.error, { op: r.op, code: r.code, stream: r.stream?.id }),
    // profiling (metrics): every operation fires pre → success|failure with a measured durationMs
    hook: (e) => {
      if (e.phase === "success") metrics.timing(e.code, e.durationMs);
    },
  },
});
```

Or just `observer: consoleObserver()` for a quiet console logger (failures only; `consoleObserver({ level: "debug" })` for the full trace). It's the batteries-included default, not a dependency you carry.

Every one of the repository's operations and the storage calls it makes — `commit`, `rebuild`, `forget`, `append`, `read`, … — fires the hook lifecycle, so you get latencies, throughput, error rates, and the self-healing **cache-hit ratio** (`rebuild`'s path is reported as `no_stored` / `stale` / `current`) for free.

Three guarantees that matter for a storage layer:

- **Async-safe and non-blocking.** Console is synchronous; Splunk HEC and a New Relic agent are not. The library never `await`s your observer and swallows any throw or rejection — a slow or broken telemetry sink can neither slow nor break a storage operation. (If you need delivery guarantees, buffer inside your plugin.)
- **Observation only.** The hooks are passive — nothing they return changes what the library does. To change storage behaviour, write an adapter, not an observer.
- **Metadata only, by construction.** Hook and log payloads are typed as primitives, so an event payload _cannot_ be emitted. This is enforced by the type, not by discipline — because an observer that logged payloads would exfiltrate PII into your telemetry backend and silently defeat right-to-forget (you can strip the event store; you can't strip Splunk).

---

## FAQ

### Do I actually need event sourcing?

Often, no — and that's the honest answer most libraries skip. Ask:

- Do you need the full timeline of how each record reached its current state?
- Will you gain from deriving _new_ read models retroactively, from history you didn't know you'd want?
- Is an audit trail a hard requirement (compliance, finance, anything regulated)?

If most answers are "yes," event sourcing earns its keep. If you only ever need the latest value and will never ask "how did it get this way?", a plain row in a table is simpler and you should use it. Adopting event sourcing for a CRUD problem buys you cost without the upside.

### Is this CQRS? Do I need a message bus?

No, and no. Event sourcing is a _storage_ choice — how you persist state. CQRS (separating reads from writes) and messaging/streaming infrastructure are independent concerns you can add or skip. This library is "data on the inside": it has no transport, no broadcasting, no bus. Wire those yourself if you want them.

### How do I version events when the payload changes?

You don't, mechanically — **versioning is a naming convention, not a feature**. A topic like `account.opened.v1` is an opaque string; the library never parses it or relates `.v1` to `.v2`. A breaking payload change means a new topic (`account.opened.v2`) and a handler for it alongside the old one. There are no upcasters and no migration engine — deliberately. Upcaster machinery is the heaviest part of most event-sourcing frameworks, and it couples your read path to a migration history. The cost of this stance: you keep handling old topics as long as old events exist. The benefit: there is no migration engine to fight, and old facts stay exactly as they were written.

### How are concurrent writes handled?

By optimistic concurrency. `commit` appends under an expected-head guard; if another writer advanced the stream first, it raises `VERSION_CONFLICT` and writes nothing. The fix is the normal one — reload, re-stage, retry:

```ts
try {
  await repo.commit(account);
} catch (err) {
  if (err.message === StorageErrors.VERSION_CONFLICT) {
    /* someone committed first — reload, re-apply, retry */
  } else throw err;
}
```

This is a real compare-and-append against the adapter's head (the `(stream, position)` unique index in Postgres/Mongo, an etag precondition in S3) — not advisory.

### What does GDPR erasure cost me, really?

A `forget` rewrites the events that hold the PII and bins the stream's projections. On Postgres and Mongo this is cheap (an in-place `UPDATE`/`replaceOne`). On S3 it rewrites the whole stream object, because the reference S3 adapter stores each aggregate as a single object — see the next question. The crypto-shredding and tombstone strategies you may have read about are alternatives with their own trade-offs; this library takes the in-place-rewrite approach because it leaves a clean, fully-readable history with no dangling key management.

### What's the performance and storage cost?

You store more data than a CRUD system — every change is a retained fact. Reads stay cheap because the self-healing repository caches projections and, when current, returns them with a single head read and no event fetch. The honest sharp edges live in the **S3 adapter**: each aggregate is one object holding the whole stream, so the object grows unbounded with the stream, every append rewrites it, and a "stale" delta read costs a full read (there are no sub-object reads on S3). That's the price of atomic single-object reads on a store with almost no features — and exactly why S3 is in the reference set. If those costs matter, choose Postgres or Mongo, where deltas are genuinely cheap.

### Why no business-logic / command layer like other frameworks?

Because that's the part you should own. A built-in decider has to learn your domain, and the moment it does, the framework is in your business rules. This library stops at "what would the state be?" and hands you the answer. Your validation is a function in your code, testable on its own, with no framework ceremony. If you want a decider pattern, you can build one on top in a few lines — but you're never forced to.

---

## Gotchas

The things a committed user hits, collected:

- **`OUTPUT_INVALID` on build** almost always means a shape gap, not bad data — usually a projection whose first folded event doesn't establish the full schema, or a handler that dropped a required field by forgetting to spread `...current`. See [the sharp edge](#getting-started) above.
- **`VERSION_CONFLICT` is normal**, not exceptional — it's how the library tells you another writer won the race. Catch it and retry the load→stage→commit cycle.
- **Mongo requires a replica set** (even single-node). Multi-event appends run in a transaction, and Mongo has no single-statement multi-document atomic write. A standalone `mongod` will fail at commit.
- **Provisional positions collide by design.** Two processes staging onto separately-loaded copies of an aggregate both assign the same next index. Reconciling that is the repository's optimistic-concurrency job at commit, not the aggregate's.
- **Unmapped topics are tolerated.** `build` folds the events a projection has handlers for and skips the rest — a projection need not handle every event on its aggregate.
- **One adapter per repository.** Spreading a stream across stores is your plumbing behind the port — the library doesn't solve it, and doesn't prohibit it.

---

## Packages

| Package                                    | Role                                                      | Install it when…                          |
| ------------------------------------------ | --------------------------------------------------------- | ----------------------------------------- |
| `@hilaryosborne/sourcing`                  | core — events, aggregates, projections, strippers         | always                                    |
| `@hilaryosborne/sourcing-persistence`      | the repository — registry, projection store, self-healing | you want stored, self-healing projections |
| `@hilaryosborne/sourcing-adapter-postgres` | storage adapter — Postgres                                | events live in Postgres                   |
| `@hilaryosborne/sourcing-adapter-mongo`    | storage adapter — Mongo (needs a replica set)             | events live in Mongo                      |
| `@hilaryosborne/sourcing-adapter-s3`       | storage adapter — S3 (the brutal one)                     | events live in object storage             |

Core depends only on Zod and nanoid; persistence depends on core; core never depends on persistence. The whole storage layer is optional.

## Going deeper

Per-part guides with exact signatures, full error tables, and real driver wiring:

- [**Concepts**](docs/skills/sourcing-concepts/SKILL.md) — the mental model in depth.
- [**Events**](docs/skills/using-events/SKILL.md) · [**Aggregates**](docs/skills/using-aggregates/SKILL.md) · [**Projections**](docs/skills/using-projections/SKILL.md) · [**Storage adapters**](docs/skills/using-storage-adapters/SKILL.md)

## License

MIT © Hilary Osborne
