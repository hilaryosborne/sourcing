# FOUNDATION.md — Epic 0: The Conceptual Model

**This is the architecture. Read it before writing anything. Where this document and any sample code disagree, this document wins.**

This file is the output of a design session. It captures *what the library is* at the conceptual level. The detailed shapes — exact Zod fields, method signatures — you will draft and bring back for ratification (see DRAFT-AND-HALT.md). But the *model* below is settled and not yours to change.

---

## What this library is, in one sentence

A domain-agnostic mechanism for defining **events**, holding them in **aggregates**, and deriving state from them via **projections** — with no business logic and no storage opinions.

---

## How the pieces fit: aggregate, repository, storage adapter

This is what resolves where everything lives. Keep it in mind constantly.

- **The aggregate.** It holds whatever events you put in it, keeping committed events separate from staged ones. It has no dependency on storage — it does not fetch or store, and has no idea where events come from or go.
- **The persistence layer is the repository.** It decides what to fetch from storage, how much (a full stream, or just the events since a known position), composes those events into an aggregate, reads the result, and decides what to store. The repository lives **outside core**, in an optional package.
- **Storage is the storage adapter.** Postgres, Mongo, S3. The repository knows how to talk to it; the aggregate does not know it exists.

**The core ships the aggregate. The persistence layer ships the repository. The adapters are the storage implementations.** Core has no concept of a repository or a storage adapter.

---

## The three core pieces

### Events

- An event is an **immutable, past-tense fact**. It has a topic (an opaque unique string like `file.create.v1`), a payload validated against a schema, and metadata (id, position, aggregate reference, creator, headers, created timestamp).
  - **Position is single and stream-local.** An event carries exactly one position: its index within its own aggregate's stream — the only position core can know, since core only ever sees one aggregate at a time. Any global or cross-stream sequence is a persistence-layer concept the repository assigns itself, outside core.
  - **`id` is assigned eagerly at creation; `position` provisionally at staging.** Identity is intrinsic and must be referenceable while an event is staged, before persistence exists — so `id` is set when the event is created. `position` only means "index in this stream," so it is set when the event is staged onto an aggregate (not at creation, not deferred to commit); staged events need provisional positions or Scenario 3 (projecting would-be state) cannot work. **Provisional means provisional:** discarded staged events evaporate their positions, and two processes staging onto separately-loaded copies of the same aggregate will both assign the same next index. **Reconciling that collision is the repository's job** (optimistic concurrency / expected-version at commit), never core's — core assigns the obvious next index in the aggregate it can see and stops there. Core is not clever about concurrency.
  - **`creator` is required at staging; `headers` are optional.** Both are caller-supplied and opaque pass-through — core never interprets them. `creator` has no default: a permanent immutable event with bogus provenance is worse than one that refuses to be created, so a missing creator fails loudly. `headers` defaults to empty (decoration, genuinely optional). The asymmetry is deliberate — provenance on an immutable fact must not be guessable.
- The **event definition** owns the payload schema. It is the only thing that deeply understands its own payload.
- The library validates payloads against their schema. A payload that fails validation is a mechanical error — one of the few the library raises.
- **Topics are opaque.** The library never parses them, never relates `file.create.v1` to `file.create.v2`. Versioning is a convention the user follows in the topic string; the library does not care.
- **Topic uniqueness is local, never global.** There is no global topic registry and no cross-aggregate uniqueness — `file.create.v1` may legitimately live on many aggregates. A topic collision is an error only within a single scope: registering two event definitions for the same topic onto one aggregate definition, or two mappers for the same topic within one projection. Uniqueness is scoped to the definition that registers it.

#### Strippers (the right-to-forget capability)

Events are *almost* immutable. The one sanctioned mutation is **stripping**, for right-to-forget / data-erasure scenarios. This lives at the event layer because only the event understands its payload.

- An event definition can register **named, contextual strippers** — pure functions that redact a payload for a given context:

  ```js
  const UserEventUpdateV1 = event("user.update.v1", z.object({
    uid: z.string().min(1),
    name: z.string().optional()
  }));

  UserEventUpdateV1.strip('gdpr', (payload) => ({ ...payload, name: undefined }));
  ```

- Strippers are named so they can be contextual — `'gdpr'`, `'export-redaction'`, `'support-view'`, whatever the consumer needs. Each is defined next to the event it redacts.
- At the aggregate level, `aggregateInstance.strip('gdpr')` walks the events and, for each one whose definition has a matching named stripper, applies it — returning a **new aggregate** (or new event set) rather than mutating the existing aggregate in place.
- **The result preserves identity, not object instances.** Each stripped event is a *new instance* carrying the same id, same position, same topic, and same metadata, with the redacted payload. Strippers are pure functions that return new payloads; nothing is mutated in place and no marker is appended. If PII survives in the produced events, the strip failed. That is the pass/fail test.
- **The library does not persist anything.** `strip` produces stripped events/state in memory. Whether storage then overwrites the originals is entirely the adapter's concern, and the core has no opinion on it. Erasure = strip → (consumer persists via the persistence layer) → rebuild projections. Only the strip is core's job.
- The library does **not** append a "redaction happened" marker. If a consumer wants an audit trail of erasure, they emit their own event. That is a business concern, not ours.

### Aggregates

- An aggregate is a **stream container with identity**. It holds a stream of events for one aggregate id.
- **Two levels: definition and instance.** An aggregate *definition* carries a name and its registered event types — it knows which events are legal on it (and is where the per-aggregate topic-uniqueness check bites). An aggregate *instance* is an id plus the stream of events under it. The scenarios say "aggregate id" as shorthand; the type/name dimension is real and necessary.
- **An instance's id defaults to a core-generated identifier** (a nanoid, exactly as an event's `id` is minted), so an aggregate is identifiable without any storage — Scenario 1 (core-only) depends on this. A consumer may supply an explicit id, and a storage adapter *may* override id generation if it has a reason, but core-minting is the default. Storage is never the primary minter — that would leak adapter-specific id semantics (a Mongo ObjectId, a Postgres sequence, an S3 key) into the id, the exact abstraction leak this design fights.
- It maintains a **committed/staged split**: committed events (already persisted, the durable history) versus staged events (proposed, not yet committed). This split is load-bearing — see "Staged events" below.
- It can be *given* events (import), have new events *added* (staged), expose its events, and report its position. It does **not** fetch, store, or orchestrate anything.
- **The aggregate is NOT a consistency boundary and enforces NO invariants.** This is a deliberate ruling. It does not have a command layer, it does not check business rules, it cannot reject an event for being "not allowed." It is a faithful container. All judgment about whether an event *should* exist lives in the consuming application.

### Projections

- A projection is a **pure builder**: a projection *definition* declares an **output Zod schema** (the read-model shape) and a set of mappers keyed by topic. Given events, `build()` folds them through the mappers and **validates the produced state against the output schema on every build** — a failure there is one of the sanctioned mechanical errors. Topic uniqueness within the mapper map is enforced (see Events).
- **The first folded event establishes the shape; there is no separate `initial` seed.** The creating event (e.g. a `*.create.v1`) is responsible for producing the model's base shape, and handlers fold over `current` defensively. A projection whose first folded event does not yield a schema-valid base **fails validation by design** — this is an intended, documented contract, not a latent bug to paper over. The builder can also fold over a **supplied starting state** (resume), which is what lets the self-healing repository apply only the delta on top of a stored projection (Scenario 2) instead of replaying from the first event.
- **A projection carries a name**, which is its identity in the projection store. Core projections are not anonymous; the name is how the persistence layer keys one projection apart from another for the same aggregate.
- Projections hold no independent truth. They are derived. They can be thrown away and rebuilt at any time.
- The only errors a projection raises are mechanical — a malformed mapper, a validation failure on the produced model.
- Because projections are pure derivations, **right-to-forget downstream is automatic**: once underlying events are stripped, you bin every projection and rebuild, and the PII is gone from the read side with no per-projection work.

---

## Staged events: why the committed/staged split matters

This is the mechanism that lets the consuming app do business validation **without the library ever knowing what validation is.**

The app stages an event (adds it to the aggregate without committing), builds the would-be projection including that staged event, and inspects the result. If the projected state violates a business rule (e.g. balance goes negative), the app rejects it and never commits. If it's fine, the app commits.

- Building the would-be projection is **the library's responsibility.**
- Judging the result is **the app's responsibility.**

This is the concrete payoff of "mechanism, not judgment." The library answers *"what would the state be if this event were real?"* — it never answers *"is this event allowed?"*

---

## The three read scenarios (these define what the layers must support)

### Scenario 1 — Projections on demand
All events are loaded from somewhere (memory, a database — core doesn't care), run through the projection builder, result returned, nothing stored. The projection is ephemeral. **Needs only: the projection builder + a source of events.** No persistence package required. This is the purest use of the library.

### Scenario 2 — Projections from storage (the self-healing scenario)
The common case, and the one with the most opinion behind it. The algorithm:

1. A projection is requested for an aggregate id.
2. Fetch the stored projection. It carries **the aggregate id and the position of the last event it was built from** (its bookmark).
3. Ask the **aggregate registry** (a simple lookup of `aggregate id → current head position`) for the current position.
4. Decide:
   - **No stored projection** → fetch the full event stream from the start, build from scratch.
   - **Registry head > projection position** → stale; fetch **only the events after the projection's position** (the delta), apply them on top of the existing projection state using the current projection shape.
   - **Registry head == projection position** → current; **return as-is, no event fetch.** The cheap path — a single cheap registry read lets you skip the expensive delta fetch entirely.

**This whole algorithm, the aggregate registry, and the projection store live in the PERSISTENCE LAYER, not in core.** Core has no concept of a registry. (See "The B ruling" below.)

### Scenario 3 — Staged events on top of stored events
Take the stored projection (or stored events) and apply additional events that are not yet committed — drafts, or events in a transient state you want to preview. Same projection builder; the delta is sourced from the caller's hand rather than from storage. This is the committed/staged split doing its job, and it is the Scenario-1/2 mechanism plus a staged overlay.

---

## The B ruling: where the cleverness lives

**Decision: the self-healing algorithm, the aggregate registry, and the projection-store contract live in the persistence layer — NOT in core. ("Option B.")**

The reasoning: "no dependency on storage" is meant literally. A registry is a storage concept. If core defined the registry interface, core would contain a storage concept. So it doesn't. Core never says the word "registry."

The proof this is correct: Scenarios 1 and 2 use the *same* core aggregate and projection builder. The only difference is **who fills the aggregate** — in Scenario 1 the consumer fills it; in Scenario 2 the self-healing repository fills it. Core cannot tell the two scenarios apart, and *that is the point*. An aggregate does not care who fills it. If core held the algorithm, it would have to know which scenario it was in. It doesn't, so it can't, so it's right.

The self-healing algorithm is not *lost* under B — it is *located correctly*. It lives in a real, named, reusable persistence package that composes core's builder with storage. It depends on core; core never depends on it.

---

## Layer summary

- **Core:** event definitions + strippers; the aggregate (import / add / committed / staged / export / position); the projection builder; the staged-events mechanism. **Zero storage concepts.**
- **Persistence layer (the repository — separate, optional packages):** the aggregate registry, the projection store contract, and the self-healing three-outcome algorithm. Composed *on top of* core.
- **Adapters (the storage implementations — under the persistence layer):** concrete Postgres / Mongo / S3 implementations behind the persistence-layer interface. Tested against real services via Docker Compose.

---

## Storage adapter scope (the triangulation)

Three deliberately different reference adapters are in scope. They are chosen as a forcing function: if one interface can be honestly implemented by all three, the interface is correct.

- **Relational (Postgres):** transactions, joins, `UPDATE` by (stream, position).
- **Document store (Mongo):** documents, change streams, `replaceOne`.
- **Object/file store (S3):** essentially `put` / `get` / `list-by-prefix` and little else. **S3 is the brutal one** — if the interface works for S3, it works for anything, because S3 has almost no features to lean on.

Anything all three can do (or be made to do under the hood) is in scope for the interface. Anything that *requires* one store's special powers cannot be in the shared interface — it would have to be an optional advertised capability, or it's out of scope. **The storage interface itself is drafted by you and ratified by Hilary before any adapter is built** (Epic 4, Draft-and-Halt).

### Right-to-forget and the storage interface
Erasure requires *overwriting* events in place (the stripped payload replaces the original). Append is easy everywhere; overwrite is the operation that pressure-tests the interface hardest — trivial in Postgres/Mongo, expensive in S3 (you rewrite whichever object holds the event, and if events are batched per object you rewrite the batch). Flag this explicitly when drafting the interface.

---

## What is explicitly OUT of scope for core

- Business logic / invariant enforcement / command handling.
- Storage of any kind (it's the persistence layer's job).
- Transport (Socket.IO, HTTP — the consumer wires these).
- Domain event broadcasting (that is "Data on the Outside" — a separate concern; this library is "Data on the Inside").
- Event versioning / upcasting / migration.
- Ordering guarantees from anything other than its own stream.