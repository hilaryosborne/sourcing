# REFINEMENTS — the tech-lead questions, recorded as next steps

The library is built, tested, and proven (Epics 0–7). This is the **adoption-readiness backlog**: the questions a senior engineer or tech lead will ask when evaluating it for a real production system, the honest gap behind each, and a direction. None of these block the current scope; they are where "built" becomes "battle-ready."

Recorded 2026-06-15. Prioritised **P0** (adoption blocker for common cases) → **P3** (nice-to-have / advanced).

---

## A. Scale & performance

### A1 · Snapshots / long streams — **P0**
**The question:** "An aggregate with 100k events — do I really replay all of them on every load and every cold projection build?"
**Gap:** Yes, today. FOUNDATION deliberately declined snapshotting. For short-to-medium streams this is fine; for high-churn aggregates it's an O(stream) cost on the hot path. Self-healing helps _stored_ projections (delta folds), but `repo.load` and a first build still replay from event 0.
**Direction:** An **optional, consumer-opt-in snapshot** capability — a `(stream → state, position)` cache the repository can seed a build from, defaulting off so the core stays snapshot-free. Must not reintroduce a read seam (FOUNDATION's reason for declining it). Frame as an adapter/repository capability, not a core concept.

### A2 · S3 unbounded growth — **P1**
**The question:** "The S3 adapter rewrites the whole stream object on every append — what happens at 50MB?"
**Gap:** Documented and real (single-object-per-aggregate is the price of atomic reads). No segmentation.
**Direction:** Document a hard guidance threshold ("S3 adapter suits low-to-moderate stream lengths; use Postgres/Mongo for high-churn"). Optionally explore a segmented S3 layout behind a capability flag — but only if it can keep atomic reads.

### A3 · Bulk projection replay / backfill — **P1**
**The question:** "I'm adding a new read model. How do I build it across a million existing streams — is there a batch tool?"
**Gap:** `rebuild` is per-(stream, projection). No fan-out/backfill utility.
**Direction:** A documented batch-replay recipe + possibly a `repository` helper that iterates known streams (needs a stream-enumeration capability on the adapter, which the port doesn't currently require — call it out as optional).

---

## B. Schema evolution

### B1 · Event versioning ergonomics — **P0**
**⊘ Superseded by Epic 8 (PLAN-EVENT-VERSIONING.md)** — the library no longer stays out of versioning; it ships first-class type-safe upcasters. Retained for history.
**The question:** "‘Versioning is a naming convention' is elegant, but in year three I have v1/v2/v3 of ten events and every projection carries handlers for all of them. How do I deprecate?"
**Gap:** No upcasting is a deliberate, defensible stance — but the consumer-side cost (handler accretion, read-path cruft) is currently undocumented beyond "you keep handling old topics."
**Direction:** A first-class **migration/evolution guide**: the consumer-side patterns for (a) a one-time rewrite-forward (append a v2, stop emitting v1), (b) a shared mapper old→new applied at fold time, (c) when a true overwrite-migration is justified. The library may stay out of it, but the _guidance_ is missing and tech leads will ask for it before committing.

---

## C. Consumer ergonomics

### C1 · A retry helper for VERSION_CONFLICT — **P1**
**The question:** "Every write site now hand-rolls a load→stage→commit retry loop. Can the library give me one?"
**Gap:** Optimistic concurrency is surfaced cleanly, but the retry ceremony is on every consumer.
**Direction:** A small, optional `withConcurrencyRetry(fn, { attempts, backoff })` helper in persistence (still mechanism — it only retries on `VERSION_CONFLICT`, never judges). Keep it opt-in.

### C2 · A consumer test kit — **P0**
**The question:** "How do I unit-test my aggregates and projections? Is there an in-memory store and a given/when/then?"
**Gap:** The library has excellent internal test infrastructure (`memoryStorage`, the conformance harness) but **none of it is exported** for consumers. They'll reinvent an in-memory adapter on day one.
**Direction:** Publish a **`@hilaryosborne/sourcing-testing`** (or a `/testing` subpath): an exported in-memory `StorageI`, plus optional given/when/then helpers ("given these committed events, when I stage X, the projection is Y"). High leverage for adoption; low risk (the code already exists).

### C3 · A typed initial-state alternative for projections — **P2**
**The question:** "The ‘first folded event must establish the whole shape or you get a runtime OUTPUT_INVALID the types didn't catch' edge is sharp. Can I opt into an explicit initial state?"
**Gap:** The ergonomic default (complete `current`, no `Partial`) has a documented runtime sharp edge.
**Direction:** Consider an optional `projection(name, schema, { initial })` overload that seeds the fold, trading the no-`Partial` ergonomics for compile-time safety. Keep the current default; offer the alternative.

---

## D. Read-side gaps (the big one)

### D1 · Cross-stream / list & search read models — **P0**
**The question:** "Projections are per-aggregate-stream. How do I build ‘all open orders for a customer' or a search index across streams?"
**Gap:** This is the most significant conceptual gap for real apps. The self-healing projection is single-stream; many — arguably most — read models span streams. Today that's entirely the consumer's problem with no story.
**Direction:** A documented **subscription / cross-stream projection** pattern: how to feed committed events into a consumer-owned read model that spans aggregates (likely via the observability hook or a dedicated read-side feed). May need a new capability (an ordered, resumable event feed across streams) — which collides with the "no global ordering on the shared port" stance, so it must be an _optional advertised capability_, not a core promise. Worth a design session of its own.

---

## E. Integration & workflow

### E1 · Reliable event publishing (outbox) — **P1**
**The question:** "After I commit, I need to publish to Kafka/SNS. How do I do that without dual-write inconsistency?"
**Gap:** The library is "data on the inside" — no broadcasting, by design. But the outbox pattern is the standard bridge and there's no guidance.
**Direction:** A documented **transactional outbox** recipe (append integration-event rows in the same store/transaction as the events, relay separately). The observer hook is _not_ sufficient (it's fire-and-forget, no delivery guarantee — and we say so) — be explicit that observability ≠ integration.

### E2 · Sagas / process managers (cross-aggregate workflows) — **P2**
**The question:** "An order touches inventory and payment aggregates. How do I coordinate a workflow across them?"
**Gap:** Single-aggregate by design; no process-manager story.
**Direction:** Documented pattern only (the library shouldn't grow a saga engine). Show how a consumer composes multiple aggregates + the staged-preview discipline.

---

## F. Observability depth

### F1 · Adapter-internal tracing — **P2**
**The question:** "The observer sees the port boundary, but I want the actual SQL time / S3 retry count for a slow append."
**Gap:** Instrumentation is at the repository/port boundary (a deliberate choice that keeps adapters clean); adapter internals are opaque.
**Direction:** An optional adapter-level observer seam for consumers who need driver-depth tracing, kept separate from the repository observer so the clean-adapter property is preserved by default.

---

## G. Production-readiness signals

- **G1 · First release & semver policy — P0.** Packages are at `0.0.0`. Define the versioning/semver/changelog policy, cut `0.1.0` via the changesets workflow, and document stability expectations. Tech leads check "is this maintained / what's the version story" first.
- **G2 · Coverage & CI visibility — P2.** Surface test-coverage numbers and CI/conformance badges in the README so the rigor is _visible_, not just real.
- **G3 · More adapters / BYO certification — P2.** A DynamoDB or SQLite reference adapter widens reach; more importantly, **document the conformance suite as the BYO-adapter acceptance test** (it already certifies any `StorageI`) so a consumer can certify their own adapter.
- **G4 · Multi-tenancy & security guidance — P3.** Stream-naming conventions for tenant isolation; what an adapter must guarantee. Brief, but asked in any B2B eval.

---

## Suggested ordering

If we pick the work back up, the highest adoption leverage for the least risk is roughly:

1. **C2** (test kit — code exists, just export it) and **G1** (cut a real release).
2. **D1** (cross-stream read models — the biggest conceptual gap; deserves a design session).
3. **B1** (versioning/migration guide) and **A1** (optional snapshots).
4. **C1** (retry helper), **E1** (outbox recipe), then the rest.

Items D1, A1, and the "optional advertised capability" ones touch the storage contract — those re-enter [DRAFT-AND-HALT](./DRAFT-AND-HALT.md), not a casual edit.
