---
name: sourcing-concepts
description: >-
  The mental model for CONSUMING the @hilaryosborne/sourcing event-sourcing library — the
  "why" behind events, aggregates, projections, the repository, storage adapters, strippers,
  staged events, and self-healing. Load this first when helping someone USE the published
  packages (not contribute to them): before defining a domain, choosing a layer, debugging a
  projection that won't build, or reasoning about right-to-forget. Companion how-to skills go
  deeper per part: using-events, using-aggregates, using-projections, using-storage-adapters.
---

# Consuming `@hilaryosborne/sourcing` — the mental model

This is the **why**. Grasp it and the parts compose themselves; skip it and you will misuse them. The one-line thesis:

> **The library is mechanism, not judgment.** It records facts and derives state from them. It never decides whether a fact is _allowed_ — that is your application's job, always.

## The three nouns (keep these straight above all else)

| Noun                | What it is                                                              | What it must NOT do                         |
| ------------------- | ----------------------------------------------------------------------- | ------------------------------------------- |
| **Aggregate**       | An in-memory container for one entity's event stream (core).            | Fetch, store, or enforce any business rule. |
| **Repository**      | The optional persistence layer that reads/writes and heals projections. | Judge events; assume a single global store. |
| **Storage adapter** | The swappable backend (Postgres / Mongo / S3 / yours).                  | Leak its identity up to the aggregate.      |

Dependency flows one way: **adapter ← repository ← core**. Core never imports persistence. That is not a style choice — "no dependency on storage" is meant _literally_, so core does not even contain the word "registry."

## Events: immutable, past-tense facts

An event is a **topic** (an opaque, unique string like `account.opened`) plus one or more **versioned payloads** (each validated by a Zod schema), plus metadata (id, position, version ordinal, aggregate ref, creator, headers, timestamp).

- **An event evolves through an ordered version chain.** Each persisted event records an opaque **version ordinal**; at read the library walks it forward through your declared **upcasters** so consumers only ever see the latest shape. The topic string stays opaque — the library never parses it; it just applies the version chain you declared, by order. No migration engine, nothing rewritten on disk.
- **Standalone.** An event definition is built on its own; the _same_ definition can be registered on many aggregates. Topic uniqueness is local (per aggregate, per projection), never global.
- **`id` at creation, `position` at staging.** Identity is intrinsic (a nanoid, minted when you `create()`). Position only means "index in this stream," so it is stamped when the event is staged onto an aggregate — and it is _provisional_ until committed.
- **`creator` is required; `headers` optional.** Provenance on a permanent fact must not be guessable, so a missing creator fails loudly. Both are opaque pass-through — the library never interprets them.

## Aggregates: a faithful container, not a consistency boundary

An aggregate holds one id's stream and keeps two sets apart:

- **committed** — the durable history (what storage has).
- **staged** — proposed events, not yet committed.

This is the single most important structural fact in the library. **The aggregate enforces NO invariants** — no command layer, no rule-checking, no rejecting an event for being "not allowed." It is deliberately dumb. All judgment lives in your app. (Definition vs instance: a _definition_ — `aggregate("account")` — knows which events are legal; an _instance_ is an id plus its stream.)

## Projections: pure, disposable derivations

A projection is a **pure builder**: a name + an output Zod schema + one handler per event topic. `build()` folds the events through the handlers and **validates the result against the schema on every build**. Projections hold no independent truth — bin them and rebuild any time.

**The load-bearing contract — the first folded event establishes the shape.** There is no separate `initial` seed. Handlers are typed `(current: State, event) => State` — a _complete_ `current`, not a `Partial`. You keep that promise by seeding the full model in your _creating_ event (e.g. `*.opened`). Break it — make a projection whose first folded event doesn't establish the whole shape — and you get a runtime validation error the types said couldn't happen. That sharp edge is the deliberate price of not writing `current.x | undefined` in every handler. (See using-projections for how to stay on the right side of it.)

## Staged events: business validation without the library knowing what validation is

This is the concrete payoff of "mechanism, not judgment," and the reason committed/staged is split:

1. Your app **stages** an event (adds it without committing).
2. It asks the library to **build the would-be projection**, including the staged event.
3. It **inspects** the result. Rule violated (balance goes negative)? Reject; never commit; the staged event evaporates. Fine? Commit.

The library answers _"what would the state be?"_ Your app answers _"is this allowed?"_ The library never learns what the rule was.

## The repository & self-healing: where the cleverness lives

Storage concepts (registry, projection store, the healing algorithm) live in the **persistence layer, never core** — because they _are_ storage concepts. The proof this is right: folding a projection from events you hold in memory and rebuilding one from storage use the _same_ core builder; only _who fills the aggregate_ differs (you, vs the repository reading storage). Core can't tell them apart, and that is the point.

**Self-healing** is one cheap head read (`aggregate id → current head position`) deciding among three outcomes:

- **No stored projection** → full build from the first event.
- **Head > bookmark** (stale) → fetch **only the delta**, fold it over the stored state. (This is why `build` takes an optional starting state.)
- **Head == bookmark** (current) → return as-is, **no event fetch**. The cheap path.

## Right-to-forget: the one sanctioned mutation

Events are _almost_ immutable; the single exception is **stripping** for erasure. An event declares named, contextual strippers (`strip("gdpr", fn)`) next to itself, because only the event understands its payload. Stripping returns a **new** aggregate/events with the same id/position/topic/metadata and a redacted payload — nothing is mutated in place, no marker is appended. The pass/fail test: **no PII survives in the produced events.**

End to end (the repository owns the sharp ordering): **load → strip → overwrite events in place (by `(stream, position)`) → bin every projection for the stream.** Binning is load-bearing: skip it and a cached "current" projection can still serve PII, because in-place redaction doesn't move the head. The operation is **idempotent and convergent under retry** — re-run it until it completes; completion is an operational obligation, not best-effort.

## What this library is deliberately NOT

Out of scope, on purpose: business logic / invariant enforcement / commands; storage opinions in core; transport (HTTP/sockets); domain-event broadcasting ("data on the outside"); version _semantics_ & byte migration (the library applies your declared upcasters by order, but never interprets what a version means or rewrites stored bytes); any ordering guarantee beyond a single stream. If you reach for one of these, it lives in _your_ app or your adapter, not here.

## When NOT to reach for the persistence layer

The in-memory paths are **core only** — no database, no repository. If you just need to fold events you already hold (in memory, from a request, from your own query) into a read-model, install `@hilaryosborne/sourcing` alone. Add the repository only when you want events _stored_ and projections kept current for you.
