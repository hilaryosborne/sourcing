# 📖 Glossary

The vocabulary this library uses, defined precisely. Where a term has a deeper home, it's linked.

### Aggregate

A single stream of events for one thing — one account, one order, one document — and its whole history in order. It's a faithful container, **not** a consistency boundary: it enforces no business rules and can't reject an event. ([Aggregates →](/guide/aggregates))

### Aggregate definition vs. instance

The **definition** (`aggregate("account")`) is the stream _type_ and the events legal on it. An **instance** (`.instance(id)`) is one stream with an id and its events.

### Bookmark

The event `position` a stored projection was last folded up to. Comparing it to the live [head](#head) is how [self-healing](#self-healing) decides current vs. stale. Stored _with_ the state, never separately. ([data model →](/reference/data-models#storedprojectionv1-a-cached-projection))

### Committed vs. staged

An aggregate instance holds two event lists. **Committed** is durable history; **staged** is proposed-but-not-committed events. The split is what makes staged validation possible — you can build a would-be projection over staged events and judge it before committing. ([Aggregates →](/guide/aggregates))

### Conformance suite

The shared contract test (`runConformance`) every storage adapter must pass — the official ones and yours alike. Derived from the [storage port](#storage-port) contract, not any implementation. ([API →](/reference/api-persistence#conformance))

### Creator (provenance)

Required metadata on every event: `{ entity, uid }` — who or what caused it. No default; a permanent fact with bogus provenance is worse than one that refuses to be created. ([data model →](/reference/data-models#creatorschemav1-provenance))

### Cross-stream read model

A read model that folds events across **all** streams in global commit order, via a [feed](#feed) and a [processor](#processor) — the firehose shape the rest of the library avoids. Advanced, opt-in, and only on adapters that offer a feed. ([API →](/reference/api-persistence#cross-stream-read-models))

### Cursor

A read model's position in the global [feed](#feed) — the cross-stream analogue of a projection's [bookmark](#bookmark). Travels with the state.

### Destinations

The configurable locations (`events` / `projections` / `registry`) where an adapter puts each kind of data — a table, collection, or key prefix. The library targets one destination per operation and never coordinates across them. ([API →](/reference/api-persistence#configuration-seams))

### Event

An immutable, past-tense fact: a `topic`, a validated `payload`, and metadata. You append events; you never update or delete them (the one exception is [stripping](#stripper)). ([Events →](/guide/events))

### Feed

An optional, global, resumable, cursor-paged stream of every event across all streams in commit order (`StorageFeedI`). Reflects in-place redactions, so it can't leak erased PII. Not part of the core [storage port](#storage-port). ([API →](/reference/api-persistence#feed))

### First-event contract

A projection's handlers promise a complete `current` state, not a `Partial`. You keep that promise by seeding the full shape in the creating event's handler. Break it and you get an `OUTPUT_INVALID` the types said couldn't happen. ([Projections →](/guide/projections))

### Fold

Replaying a sequence of events through a [reducer](#handler-mapper-reducer) to derive a value — the operation at the heart of every [projection](#projection) and [read model](#cross-stream-read-model).

### Head

The highest event `position` in a stream (or `undefined` when empty). One cheap head read drives [self-healing](#self-healing) and [optimistic concurrency](#optimistic-concurrency).

### Handler / mapper / reducer

The pure function `(current, event) => next` that a projection or read model runs per event. Deterministic — no clock, randomness, or IO. Spread to update; never mutate `current`.

### Head shape

The latest declared version of an event's payload. Stored events are [upcast](#upcaster) to head shape when read, so consumers only ever see the newest shape.

### Mechanism, not judgment

The library's central stance: it records facts and derives state, but never decides whether a fact is _allowed_. The only errors it raises are mechanical. Business judgment is your application's job. ([Why →](/guide/what-is-sourcing#mechanism-not-judgment))

### Optimistic concurrency

How concurrent writes are reconciled: `commit`/`append` run under an expected-[head](#head) guard, and a writer who lost the race gets [`VERSION_CONFLICT`](/reference/error-index#persistence-storageerrors) and writes nothing. Normal, not exceptional — reload, re-stage, retry.

### Position

An event's 0-based index within its stream. Assigned (provisionally) at staging; provisional positions can collide across separately-loaded copies, which the repository reconciles at commit.

### Processor

The driver for [cross-stream read models](#cross-stream-read-model): `catchUp` folds the [feed](#feed) from a checkpoint in resumable batches; `rebuild` re-folds from the start. At-least-once, so handlers must be idempotent. ([API →](/reference/api-persistence#processor-deps))

### Projection

A pure fold from one aggregate's events into a read model of a declared shape, validated on every build. One stream can drive many projections; add one tomorrow and it back-fills from history. ([Projections →](/guide/projections))

### Projection store

The persistence-layer cache of built projections (state + [bookmark](#bookmark)), keyed by `(stream, name)`. What [self-healing](#self-healing) reads and updates.

### Read model

A derived, queryable view over events. Within one stream it's a [projection](#projection); across streams it's a [cross-stream read model](#cross-stream-read-model).

### Registry

A named view over the event [head](#head) (`RegistryI`) — the one cheap read self-healing relies on. Not a separate store by default.

### Repository

The persistence layer's entry point (`repository({ storage, observer })`): the write path (`create`/`load`/`commit`), the self-healing read (`rebuild`), and erasure (`forget`), over a swappable adapter. ([API →](/reference/api-persistence#repository-deps))

### Right-to-forget

Reconciling immutable history with "delete my data" by [stripping](#stripper) events in place and binning their projections. ([Right-to-forget →](/guide/right-to-forget))

### Self-healing

The `rebuild` algorithm: one head read picks the cheapest correct path — full build (no stored projection), delta fold (stale), or cache hit (current). ([API →](/reference/api-persistence#self-healing-how-rebuild-decides))

### Staged validation

The payoff of the [committed/staged split](#committed-vs-staged): stage an event, build the would-be projection, judge it in your code, then commit or reject. The library previews; your app decides. ([Use cases →](/guide/use-cases#enforce-a-business-rule-without-a-rule-engine))

### Storage adapter

A concrete implementation of the [storage port](#storage-port) for one backend — Postgres, Mongo, S3, or your own. One adapter per repository. ([Storage adapters →](/guide/storage-adapters))

### Storage port

The `StorageI` interface an adapter implements: `head` / `read` / `append` / `overwrite` for events, and `loadProjection` / `saveProjection` / `deleteProjections` for projections. The seam between the library and any backend. ([API →](/reference/api-persistence#storagei-the-storage-port))

### Stripper

A named, version-local pure function that redacts a payload for [right-to-forget](#right-to-forget) — e.g. a `"gdpr"` stripper. Its output is re-validated against that version's schema. ([Events →](/guide/events))

### Topic

An event's opaque name (e.g. `account.opened`). Unique within one aggregate; the library never relates one topic to another or parses its meaning.

### Upcaster

A pure function that lifts a payload from one event [version](#version-ordinal) to the next. The chain runs at read time, never on disk, so consumers always see [head shape](#head-shape). ([Events →](/guide/events))

### Version ordinal

The 1-based, contiguous number an event was written at (`.version(n, …)`), stored opaquely on each event. The library counts from it to apply the [upcast](#upcaster) chain; it never interprets its meaning. ([data model →](/reference/data-models#eventenvelopev1-the-persisted-event))

## ➡️ Next

- [Error index](/reference/error-index) · [Data model reference](/reference/data-models)
- [API: core](/reference/api-core) · [API: persistence](/reference/api-persistence)
