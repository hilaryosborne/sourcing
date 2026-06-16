# ⚖️ How it compares

Event sourcing has a wide and good tooling landscape. The most useful thing this page can do is be **honest about where this library fits and where something else fits better** — because the fastest way to lose your trust would be to pretend it's the right answer for everyone.

The single question that sorts the field: **are you adopting a library, a framework, or a database?**

- A **database** (EventStoreDB / Kurrent) _is_ the event store — you run it and talk to it.
- A **framework** (Axon) owns your architecture — commands, sagas, the lot.
- A **library** (this, Emmett, Marten) gives you primitives and gets out of the way.

This one is a library, and a deliberately small one: it folds events into state over _your_ existing store, and it has no opinion about your architecture. ([Our take →](/guide/what-is-sourcing#our-take-its-an-orm-not-an-architecture))

## The landscape, fairly

> Characterised by _kind_ and _philosophy_, not a feature race — tools move, so check each project's current docs before you decide.

|                                                         | Kind          | Language    | Storage                                              | Architecture stance                                     |
| ------------------------------------------------------- | ------------- | ----------- | ---------------------------------------------------- | ------------------------------------------------------- |
| **`@hilaryosborne/sourcing`**                           | small library | TypeScript  | your Postgres / Mongo / S3 / own, behind one port    | none — mechanism, not judgment; no command layer        |
| **[Emmett](https://event-driven-io.github.io/emmett/)** | library       | TypeScript  | pluggable (EventStoreDB, Postgres, Mongo, in-memory) | leans into the functional decide/evolve (decider) model |
| **EventStoreDB / Kurrent**                              | database      | client SDKs | its own engine                                       | a purpose-built store with server-side subscriptions    |
| **[Marten](https://martendb.io/)**                      | library       | .NET        | PostgreSQL                                           | document DB + event store, richly featured              |
| **Axon Framework**                                      | framework     | Java/JVM    | pluggable                                            | full CQRS + DDD + sagas, opinionated end to end         |
| **Roll your own**                                       | —             | any         | any                                                  | whatever you build                                      |

## When to reach for something else

We'd genuinely rather you used the right tool:

- **You want a dedicated event store with built-in subscriptions and don't mind operating it** → **EventStoreDB / Kurrent.** It's a purpose-built engine; this library is the opposite bet (no new infrastructure, your existing database).
- **You're on .NET and Postgres** → **Marten.** It's excellent and battle-tested in that ecosystem; this is a TypeScript library.
- **You want the full CQRS/DDD architecture handed to you on the JVM** → **Axon.** It owns command handling, sagas, and routing; this library deliberately owns none of that.
- **You're in TypeScript and you _like_ the decider/command model** → **Emmett.** It's the closest neighbour in spirit and a great library; the difference is mostly philosophical (below).

## Where this one is different

Against the nearest neighbour (a TypeScript library), the distinguishing bets are:

- **No business-logic layer, at all.** There's no decider, command handler, or rule engine to adopt — you [stage an event, preview the would-be state, and decide in your own `if`](/guide/use-cases#enforce-a-business-rule-without-a-rule-engine). The framework never gets between you and your domain.
- **Storage-agnostic behind one tiny port.** Three reference adapters (Postgres, Mongo, S3) prove one [interface](/reference/api-persistence#storagei-the-storage-port), all certified by a shared [conformance suite](/reference/api-persistence#conformance) — and you can [write your own](/guide/write-own-adapter).
- **Right-to-forget is a first-class mechanism**, not an afterthought — in-place stripping reconciled with immutable history, and an observer that's [structurally unable to leak the PII back out](/guide/observability#_3-metadata-only-by-type-not-by-discipline).
- **Self-healing projections** out of the box: one cheap head read picks full-build / delta / cache-hit. ([Repository →](/guide/repository))
- **A genuinely tiny core** — two dependencies, no storage, runs in memory.

## "Isn't this just rolling my own?"

In spirit, yes — and that's a compliment. The difference is the sharp edges are already solved and tested for you: optimistic concurrency, the upcast chain, in-place erasure, the self-healing read, and a conformance suite that proves an adapter is correct. Rolling your own means re-discovering each of those under load. This is rolling your own, with the landmines mapped.

## ➡️ Next

- [Why event sourcing?](/guide/what-is-sourcing) — the philosophy in full.
- [Common use cases](/guide/use-cases) — and the doubts, answered.
- [Roadmap](/project/roadmap) — what's shipped and what's deliberately not.
