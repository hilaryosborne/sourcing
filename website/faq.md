# FAQ & edge cases

## Do I actually need event sourcing?

Often, no — and that's the honest answer most libraries skip. Ask:

- Do you need the full timeline of how each record reached its current state?
- Will you gain from deriving _new_ read models retroactively, from history you didn't know you'd want?
- Is an audit trail a hard requirement (compliance, finance, anything regulated)?

If most answers are "yes," event sourcing earns its keep. If you only ever need the latest value and will never ask "how did it get this way?", a plain row in a table is simpler and you should use it. Adopting event sourcing for a CRUD problem buys you cost without the upside.

## Is this CQRS? Do I need a message bus?

No, and no. Event sourcing is a _storage_ choice — how you persist state. CQRS (separating reads from writes) and messaging/streaming infrastructure are independent concerns you can add or skip. This library is "data on the inside": it has no transport, no broadcasting, no bus. Wire those yourself if you want them.

## How do I version events when the payload changes?

Declare a new version on the event and an **upcaster** that lifts the previous shape into it:

```ts
const AccountOpened = event("account.opened")
  .version(object({ holder: string() }))
  .version(object({ holder: object({ name: string() }), country: string() }))
  .upcast((v1) => ({ holder: { name: v1.holder }, country: "unknown" }));
```

Stored events are **never rewritten**. Each records the ordinal it was written at, and at read time the library walks it forward through your upcasters so projections and aggregates only ever see the **latest** shape. The safeguard is the type system: add a version whose shape differs and the upcaster won't compile until you write it — and every projection mapper that reads the changed shape fails to compile until you fix it. No silent drift.

This is deliberately _not_ the heavy upcaster machinery of most frameworks. There's no migration engine, no version field for the library to parse, nothing rewritten on disk, and it's opt-in per event — a single `.version()` is the common case, and you never think about upcasters until a shape actually changes. The library still understands nothing about what a version _means_; it just applies the ordered chain of pure functions you declared. Versioning stays mechanism, not judgment. (Strippers are per-version too — erasure redacts each event in its own version's shape.)

## How are concurrent writes handled?

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

## What does GDPR erasure cost me, really?

A `forget` rewrites the events that hold the PII and bins the stream's projections. On Postgres and Mongo this is cheap (an in-place `UPDATE`/`replaceOne`). On S3 it rewrites the whole stream object, because the reference S3 adapter stores each aggregate as a single object — see the next question. The crypto-shredding and tombstone strategies you may have read about are alternatives with their own trade-offs; this library takes the in-place-rewrite approach because it leaves a clean, fully-readable history with no dangling key management. See [Right-to-forget](/guide/right-to-forget).

## What's the performance and storage cost?

You store more data than a CRUD system — every change is a retained fact. Reads stay cheap because the self-healing repository caches projections and, when current, returns them with a single head read and no event fetch. The honest sharp edges live in the **S3 adapter**: each aggregate is one object holding the whole stream, so the object grows unbounded with the stream, every append rewrites it, and a "stale" delta read costs a full read (there are no sub-object reads on S3). That's the price of atomic single-object reads on a store with almost no features — and exactly why S3 is in the reference set. If those costs matter, choose Postgres or Mongo, where deltas are genuinely cheap.

## Why no business-logic / command layer like other frameworks?

Because that's the part you should own. A built-in decider has to learn your domain, and the moment it does, the framework is in your business rules. This library stops at "what would the state be?" and hands you the answer. Your validation is a function in your code, testable on its own, with no framework ceremony. If you want a decider pattern, you can build one on top in a few lines — but you're never forced to.

## Gotchas

The things a committed user hits, collected:

- **`OUTPUT_INVALID` on build** almost always means a shape gap, not bad data — usually a projection whose first folded event doesn't establish the full schema, or a handler that dropped a required field by forgetting to spread `...current`. See [Projections](/guide/projections).
- **`VERSION_CONFLICT` is normal**, not exceptional — it's how the library tells you another writer won the race. Catch it and retry the load → stage → commit cycle.
- **Mongo requires a replica set** (even single-node). Multi-event appends run in a transaction, and Mongo has no single-statement multi-document atomic write. A standalone `mongod` will fail at commit.
- **Provisional positions collide by design.** Two processes staging onto separately-loaded copies of an aggregate both assign the same next index. Reconciling that is the repository's optimistic-concurrency job at commit, not the aggregate's.
- **Unmapped topics are tolerated.** `build` folds the events a projection has handlers for and skips the rest — a projection need not handle every event on its aggregate.
- **One adapter per repository.** Spreading a stream across stores is your plumbing behind the port — the library doesn't solve it, and doesn't prohibit it.
