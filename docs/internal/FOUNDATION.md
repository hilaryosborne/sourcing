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
- **An event has an ordered version chain; core relates versions only by order, never by meaning.** An event definition has a stable base identity and an ordered list of versions — each owning a schema, named strippers, and (from the second version onward) an upcast. Each persisted event records an **opaque version ordinal — the declared, 1-based, contiguous version number** (`.version(1, …)`, `.version(2, …)`, …), not an array index. The number IS the ordinal; core sorts and counts the upcast chain along it. Core never parses or understands what a version *means*; it counts position in the declared order and runs the user's pure functions — the same posture as projection reducers and strippers: **mechanism, not judgment**. *(Reverses the prior "topics are opaque / versioning is a naming convention" ruling — see PLAN-EVENT-VERSIONING.md.)*
- **Topic uniqueness is local, never global.** There is no global topic registry and no cross-aggregate uniqueness — `file.create.v1` may legitimately live on many aggregates. A topic collision is an error only within a single scope: registering two event definitions for the same topic onto one aggregate definition, or two mappers for the same topic within one projection. Uniqueness is scoped to the definition that registers it.

#### Versions & upcasters (read-time event evolution)

An event evolves through an **ordered list of versions**, each `(schema, upcast?, strippers)`. Persisted events are written at whatever version was current and carry an **opaque version ordinal**; **upcasting never mutates them** (the only sanctioned mutation remains stripping).

- **Upcast is forward and read-only.** At consumption — projection build and aggregate import — core runs a stored payload `vN → … → head` through the declared upcast chain, so consumers only ever see the head shape. Storage is untouched.
- **The first version has no upcast** (nothing precedes it); **every later version must declare one**, transforming the previous version's output into its own. These are **runtime-validated mechanical invariants, not compile-time guarantees** (the ref-exact DSL declares each version as its own statement off a captured definition, so the type system cannot thread the chain): declaring `.upcast` on the first version raises a mechanical error at the call site (`UPCAST_ON_FIRST_VERSION`); a later version left without one raises lazily at first use — create / restore / consume / strip (`UPCAST_MISSING`); a `.version(n, …)` that breaks the contiguous-from-1 sequence raises at the call site (`VERSION_SEQUENCE`). The upcast's **input is `unknown`** — a consumer narrows it — while the upcast's **return and each version's strippers stay typed to that version's own schema.**
- **Strip is in-place and version-local.** Right-to-forget redacts the *as-stored* event, which lives at its write version — so each version owns its own named strippers, and strippers do **not** compose along the chain.
- **Stripped output must be valid for its own version.** Core re-validates a stripper's output against that version's schema and raises a **mechanical error** on failure. Consequence: every stored event is always schema-valid for its version, so **upcasters are guaranteed valid inputs** — the strip and upcast chains decouple entirely.

| | direction | touches storage? | composes to head? | re-validated? |
|---|---|---|---|---|
| **upcast** | forward (prev → this) | no | yes | input guaranteed valid |
| **strip** | in-place (this → this) | yes (persistence overwrite) | no | yes — output vs own schema |

*Deferred to the Phase-A contract gate, not settled here: whether the wire topic is the base string or base+ordinal, and the ordinal's concrete representation (index vs label) and how adapters carry it.*

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
- **Strippers are scoped per version.** A named stripper is registered on the version whose schema it redacts; right-to-forget applies the stripper matching each event's stored ordinal.
- **A stripper's output is re-validated against its version's schema.** Redaction that produces an invalid payload is a mechanical error — strip to a schema-valid sentinel, not to a value the schema forbids.
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
- **The first folded event establishes the shape; there is no separate `initial` seed — and this is load-bearing in the types.** Handlers are typed `(current: State, event) => State`: the signature **promises a complete `current`**, not a `Partial`. You keep that promise by seeding the full model shape in your creating event (e.g. a `*.create.v1`); every handler then folds over `current` defensively. Break it — a first folded event that doesn't establish the shape — and you get a **runtime validation error the types said couldn't happen**. That sharp edge is the conscious price of the ergonomic default (no `current.x | undefined` friction in every handler); it is acceptable only because it is documented prominently, here and in the consumer docs (README, the docs site, the projections guide). The builder also folds over a **supplied starting state** — the optional second argument to `build(aggregate, from?)` — which is what lets the self-healing repository apply only the delta on top of a stored projection (Scenario 2) instead of replaying from the first event.
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
Erasure requires *overwriting* events in place (the stripped payload replaces the original). Append is easy everywhere; overwrite is the operation that pressure-tests the interface hardest — trivial in Postgres/Mongo, expensive in S3 (you rewrite whichever object holds the event, and if events are batched per object you rewrite the batch). Flag this explicitly when drafting the interface. **Overwrite is the one sanctioned exception to append-only; it exists for erasure alone and is never a general-purpose update** (to correct a fact, append a new event).

---

## Single adapter per repository; spread is the consumer's concern (non-prohibition)

The library ships a **single persistence adapter per repository.** Spreading a stream — or its projections — across multiple stores is a **consuming-service concern**: the plumbing, querying, and stitching are theirs, not ours. The library's obligation is **non-prohibition** — no core or repository feature may assume single-store in a way that *blocks* a consumer from supplying their own spread implementation behind the port. This is a **scope-and-restraint** statement, not a distributed-storage solution: **we do not solve spread; we do not prohibit it.**

That is why concurrency, overwrite, and projection-cleanup are expressed as **adapter capabilities, not repository-baked assumptions.** The repository assumes only "*this* adapter's head" and "*this* adapter's cleanup" — never anything global:

- **Optimistic concurrency** — `append(stream, events, expectedHead?)` → `VERSION_CONFLICT` on mismatch — is a **mandatory** capability of every adapter: a compare-and-append against *that adapter's* head. `expectedHead` is optional at the call site (blind appends allowed); the capability is not optional. The justification is "this is what a single adapter does," not a consensus argument. S3 emulates it behind the port (conditional writes / preconditions); ugly is fine, absent is not.
- **Overwrite** (right-to-forget) is keyed by **`(stream, position)`** — within one adapter, position is the unambiguous address of a fact. The event `id`/uid is the key for append-time dedup/idempotency, **not** the overwrite key (never a uid scan-to-find).
- **Projection cleanup** under `forget` is an **adapter capability** ("remove every projection for this stream"). Our adapters colocate a stream's projections and fulfil it with a prefix-delete; a consumer who spreads projections supplies their own cleanup behind the same seam. The repository never bakes in a prefix scan.
- **Global / cross-stream ordering** is an **optional** advertised capability, never promised by the shared port. Adapters that can offer it cheaply (a single Postgres) may expose it; those that can't (S3, absent an external sequencer) don't. Consumers needing cross-stream order opt into an adapter that provides it.

**Configurable destinations (the non-prohibition seam, made concrete).** Destinations are **configurable per kind** — events, registry, projections — at persistence-init: the consumer tells each kind where to live (an adapter interprets the name as a table / key-prefix / collection), and the adapter uses it in place of a hardcoded name. This is how a consumer points projections at a different store from events **without the library solving spread.** The rule: **the library targets one destination per operation and never coordinates across destinations** — *configurable, not coordinated.* The repository must not assume two destinations are the same store, and must not try to make any operation (especially `forget`) atomic across two differently-located destinations (that is the distributed-transaction territory this stance refuses). Concretely, `forget`'s bin-all bins projections at their **configured projection destination**, never one derived from the event location: **colocation is the default, not the assumption.** (The registry is a *view* over the event head — ratified Gate 2 — so its destination defaults to the events destination; it is configured separately only by an adapter that materializes a registry, e.g. a head-pointer store, which does not change the `RegistryI.head` contract.) On S3 the destination prefix is configurable **within one bucket**; spanning buckets is spread, the consumer's concern (the bucket is store identity, fixed at adapter construction — not a destination).

**Known boundary (recorded, not this work):** migrating a stream between stores creates a transient **head-handoff** — briefly two candidate heads exist. Noted here so it is discovered on paper, not under load.

**Known boundary — forget completion is an operational obligation.** Forget is **not atomic** across its steps (read → strip → overwrite → bin projections). It is **idempotent and convergent under retry**: re-running from the top heals any partial-failure state (strip of a redacted payload is identity-preserving; overwrite of redacted-over-redacted is a no-op in effect; bin deletes whatever is cached). The PII guarantee is therefore **contingent on completion.** A forget that fails *after* overwrite but *before* bin must be retried until bin succeeds — otherwise PII may persist in a cached projection (the stream head does not move under in-place redaction, so a stale projection can read as "current"). For an operation whose purpose is right-to-forget compliance, **completion is an operational obligation, not best-effort.**

### S3 adapter — structural properties of the single-file layout

The reference S3 adapter stores each aggregate as **one object** (`aggregates/{name}/{id}.json`) holding the whole event stream. These four properties follow from that choice and are recorded so they are understood on paper, not discovered under load:

1. **Single-file for atomic reads.** The layout exists for *correctness*, not simplicity: a reader GETs the entire stream in one shot, so there is no window where a list races an in-flight commit and observes a half-written stream. That seam existed under a per-commit layout; single-file closes it. The cost below is paid deliberately for this.
2. **Unbounded object growth.** Every commit rewrites the whole object, so read and write cost grow with stream length **without bound.** This is the accepted price of atomic reads on the slow adapter; bounding it (snapshotting / segmenting) would reintroduce a read seam and is out of scope. On S3, append **reads the full object before writing it**, because etag-CAS requires the current etag; the read is load-bearing for concurrency, **not an optimization that can be skipped.** (It reads as removable and is not.)
3. **No cheap delta on S3.** There is no sub-object read on S3, so a STALE delta-fold reads the **whole** object — the same cost as a NO-STORED full build. **STALE provides no cost saving on the S3 adapter, by design.** This is a structural property, not a deferred optimization (relational/document adapters *can* read a delta cheaply; S3 cannot).
4. **Concurrent forget — resolved by etag-CAS.** Two concurrent forgets both condition their write on the object's etag; the second is **rejected, not silently lost** — it retries against the new etag, re-reads the partially-redacted object, strips its own positions, and writes. Convergent under retry — this is the §"forget completion" property, now *guaranteed* by the single-file etag-CAS rather than left open.

### Mongo adapter — operational precondition (transactions)

The Mongo adapter requires a **transaction-capable deployment (replica set)** for atomic multi-event append; Mongo provides no single-statement multi-document atomic write, so the all-or-nothing commit guarantee is met by an explicit transaction. **This is an operational precondition of the adapter, not a feature of the port** — the strain was held OUT of the port (the contract is still `append(stream, events, expectedHead?)`, `VERSION_CONFLICT` still means the same fact, a consumer cannot tell Mongo needed a transaction). The shape-neutrality of the port across S3, Postgres, and Mongo was therefore *checked*, not assumed. Relatedly, the `(stream, position)` unique index IS the compare-and-append, so it is a precondition the adapter ensures at construction — without it, append has no CAS.

---

## What is explicitly OUT of scope for core

- Business logic / invariant enforcement / command handling.
- Storage of any kind (it's the persistence layer's job).
- Transport (Socket.IO, HTTP — the consumer wires these).
- Domain event broadcasting (that is "Data on the Outside" — a separate concern; this library is "Data on the Inside").
- **Version *semantics* and byte migration.** Core applies the declared upcast chain *by order* and never interprets what a version means, infers upcasters, or rewrites stored bytes. (Declaring and applying upcasters is now IN scope — see *Versions & upcasters*.)
- Ordering guarantees from anything other than its own stream.