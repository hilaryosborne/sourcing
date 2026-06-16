# 🧰 Common use cases

Two questions run through your head when you size up a new library: **what will I actually build with this?** and **but will it survive my real-world mess?** This page answers both — the everyday builds first, then the doubts, head-on. Every snippet is the real API, and every "go deeper" link lands on a full treatment.

## What you'll build

### 📥 Turn events into a read model — with zero infrastructure

The smallest useful thing the library does: fold a list of facts into a shape you can render. No database, no repository, no config — just the core package.

```ts
const account = Account.instance();
account.events.add(AccountOpened.create({ holder: "Ada" }).creator("user", "ada"));
account.events.add(Deposited.create({ amount: 100 }).creator("user", "ada"));
account.events.commit();

Balance.build(account); // → { holder: "Ada", balance: 100 }
```

If you already hold events — in memory, from a request body, from your own SQL query — you can build a read model from them today, in one corner of your app, and never touch the rest of the library. [Getting started](/guide/getting-started) walks the full first build.

### 🛂 Enforce a business rule — without a rule engine

Stage an event _without_ committing, build the would-be projection, and judge it in your own code. The library shows you the future; your `if` statement decides whether it happens.

```ts
account.events.add(Withdrawn.create({ amount: 250 }).creator("user", "ada")); // staged, NOT committed
const wouldBe = Balance.build(account); // folds committed ++ staged → balance -150

if (wouldBe.balance < 0) {
  // your overdraw rule. The library has no opinion — reject; never commit; the staged event evaporates.
} else {
  account.events.commit();
}
```

No decider, no command bus, no rule engine to configure. The overdraw rule lives in plain code where you can read and test it. [The shopping-cart example](/examples/shopping-cart) does this end to end.

### ♻️ Persist projections that keep themselves current

Bring in the repository and an adapter. Write through `commit`, read through `rebuild` — and the stored projection stays current without you ever tracking what's stale.

```ts
import { repository } from "@hilaryosborne/sourcing-persistence";
import { postgresStorage } from "@hilaryosborne/sourcing-adapter-postgres";

const storage = await postgresStorage(pgClient, { events: "account_events", projections: "account_projections" });
const repo = repository({ storage });

const opening = await repo.create(Account);
opening.events.add(AccountOpened.create({ holder: "Ada" }).creator("user", "ada"));
await repo.commit(opening);

const balance = await repo.rebuild({ aggregate: Account, id: opening.id, projection: Balance });
```

`rebuild` makes **one cheap head read** and takes the cheapest correct path:

| Stored projection vs. stream head | What happens                                                  |
| --------------------------------- | ------------------------------------------------------------- |
| **none**                          | read the full stream, build from scratch, save                |
| **head > bookmark** (stale)       | read **only the delta**, fold it over the stored state, save  |
| **head == bookmark** (current)    | return the stored state — **no event fetch** (the cheap path) |

[The Postgres example](/examples/self-healing-postgres) wires this up against a real database.

### 🔭 Drive several views from one stream

A projection is just a fold, so one aggregate can feed as many read models as you like — a summary _and_ an access-control list _and_ a search row — each its own pure builder over the same events. Add a view tomorrow and it back-fills itself from history you already have, no migration.

[The document-lifecycle example](/examples/document-lifecycle) folds one stream into a file summary and a live access-control list, side by side.

### 🔌 Swap storage — without lock-in

Events, the registry, and projections each sit behind one interface. Postgres, Mongo, S3, or your own adapter — pick per deployment; the rest of your code doesn't move. The three reference adapters are the forcing function: if one interface honestly implements all three — down to S3, which is barely more than put/get/list — it'll carry yours too.

[Storage adapters](/guide/storage-adapters) has the exact wiring for each.

## The doubts, head-on

Now the questions that actually decide whether you trust this in production. None of them get a hand-wavy answer.

### 🗑️ "I'd be storing data forever — how do I honour a delete request?"

The honest tension of event sourcing: immutable history versus _delete my data_. The library reconciles them with **in-place stripping** — a per-version, named pure function that redacts the PII out of the stored events, in place. Each event keeps its identity, position, and ordering; only the sensitive fields change.

```ts
// the redactor is declared per event version, named for its context
UserUpdated.version(1, object({ name: string(), email: string() })).strip("gdpr", (p) => ({
  ...p,
  name: "[redacted]",
  email: "[redacted]",
}));

const erased = aggregate.strip("gdpr"); // a NEW aggregate, PII redacted, identity intact
```

Because projections are pure folds that hold no truth of their own, you bin them and rebuild — and the PII is gone from the read side too, with no per-projection work. The stripper's output is re-validated against its version's schema, so a redaction can't quietly corrupt the shape. And the observer (below) is **metadata-only by type**, so telemetry physically cannot have copied the payload back out. [Right-to-forget](/guide/right-to-forget) covers the full erase sequence; [the GDPR example](/examples/gdpr-erasure) proves no PII survives.

### 🔭 "How do I see what it's doing — and wire it to my stack?"

The repository is **silent by default** — no logs, no metrics, nothing — until you pass an `observer`. That one optional seam has three independent channels, each mapping to a thing ops teams want:

```ts
import { repository, consoleObserver } from "@hilaryosborne/sourcing-persistence";

const repo = repository({
  storage,
  observer: {
    logger: { info: splunk.send, warn: splunk.send, error: splunk.send, debug: splunk.send }, // structured logs
    report: (r) => newrelic.noticeError(r.error, { op: r.op, code: r.code }), // error tracking
    hook: (e) => {
      if (e.phase === "success") metrics.timing(e.code, e.durationMs); // profiling
    },
  },
});
```

Implement only the channel you actually wire. Not ready to write one? `consoleObserver()` is batteries-included (quiet at info — failures only). Every channel is **async-safe** (the library never awaits your sink and swallows its throws, so a slow Splunk can't slow a commit), **passive** (it observes but can never alter behaviour), and **metadata-only** (primitives only, enforced by the type — it _cannot_ carry an event payload). [Observability](/guide/observability) has the full channel reference.

### 🔢 "What happens when an event has 87 versions?" _(a real question)_

You evolve a payload by declaring a new version and an **upcaster** that lifts the previous shape forward. Stored events are **never rewritten** — each keeps the ordinal it was written at, and at read time the library walks it `vN → … → head` so your projections and aggregates only ever see the **latest** shape. At 87 versions that's an 87-link chain of small pure functions, and it just works:

```ts
AccountOpened.version(1, object({ holder: string() }));
AccountOpened.version(2, object({ holder: object({ name: string() }) })).upcast((prev) => ({
  holder: { name: (prev as { holder: string }).holder },
}));
// … versions 3 … 87, each lifting the one before it forward
```

Where does the cost land? At **build** time, not on every read. The self-healing repository folds (and upcasts) once, caches the projection, and on the _current_ path returns it with no event fetch and no upcasting at all — so a long chain taxes a cold rebuild, not your hot path.

The honest sharp edges: the chain only ever **grows** — you can't drop a version while any event written at it still exists (the chain has to keep lifting it forward; a later version left without an upcaster throws `UPCAST_MISSING` at first use). And by the time you're genuinely at 87, the event is usually trying to be too many things — most of those should have been **new topics**, not new versions of one. But that's advice, not a limit: the library stays purely mechanical about it and will not fall over. [The versioning FAQ](/faq#how-do-i-version-events-when-the-payload-changes) has the rules; [Events](/guide/events) has the mechanics.

### 🏁 "Two writers race — who wins?"

Optimistic concurrency, and it's real, not advisory. `commit` appends under an expected-head guard; if another writer advanced the stream first, it raises `VERSION_CONFLICT` and writes nothing. The fix is the normal one — reload, re-stage, retry:

```ts
try {
  await repo.commit(account);
} catch (err) {
  if (err.message === StorageErrors.VERSION_CONFLICT) {
    // someone committed first — reload, re-apply your staged events, retry
  } else throw err;
}
```

This is a genuine compare-and-append against the adapter's head — a `(stream, position)` unique index on Postgres/Mongo, an etag precondition on S3. `VERSION_CONFLICT` is **normal**, not exceptional: it's how the library tells you to retry. [Concurrency in the FAQ](/faq#how-are-concurrent-writes-handled) has the details.

## More questions?

These come up first; the [FAQ & edge cases](/faq) collects the rest — performance and storage cost, "is this CQRS?", the projection-shape gotcha, Mongo's replica-set requirement, and more. And if a use case you need isn't here, [open an issue](https://github.com/hilaryosborne/sourcing/issues) — we'd rather add the one you need than guess.

## ➡️ Next

- [Getting started](/guide/getting-started) — install and build your first projection.
- [The mental model](/concepts) — the three nouns the whole library falls out of.
- [Examples](/examples) — full domain builds you can steal.
