# Design — cross-stream read models (REFINEMENTS D1)

**Status:** exploratory v1, built and proven against an in-memory feed. Real-adapter feeds and the GDPR interaction are explicit backfill (see "Open questions"). This would normally run through [DRAFT-AND-HALT](../DRAFT-AND-HALT.md) before real-adapter rollout — recorded here so the thinking is on paper, not in a commit message.

## The problem

Every `projection` today folds **one aggregate's stream**. That covers "the balance of _this_ account," "the status of _this_ order." It does **not** cover the read models real apps spend most of their time on:

- _all open orders for a customer_ (spans every order stream)
- _a search index over documents_ (spans every document stream)
- _a dashboard: revenue this month, active carts, error rate_ (spans everything)

These are **cross-stream**: their input is the firehose of events from _many_ aggregates, and their output is one denormalised view. The single-stream projection builder structurally cannot express them — it binds to one `AggregateDefinition`, enforces topic-uniqueness per aggregate, and folds one `AggregateInstance`. There is no seam for "fold every order.placed across every order."

This is the single biggest conceptual gap in the library. Without it, a consumer building a list view is on their own with no story — which is the moment a tech lead walks away.

## Why this is genuinely hard (the contract tension)

A cross-stream fold needs to read events **across streams in a stable, resumable order**. But FOUNDATION deliberately keeps **global ordering off the shared storage port** ("Global / cross-stream ordering is an _optional_ advertised capability, never promised by the shared port"): S3 can't provide it without an external sequencer; Postgres can (a global sequence); Mongo can (an oplog / change stream). Forcing a global feed into `StorageI` would break the S3-honesty that the whole port design is built on.

So the feed **must be an optional, advertised capability** — not part of `StorageI`. An adapter that can offer an ordered global feed implements it; one that can't, doesn't, and cross-stream read models simply aren't available on that backend. This mirrors the existing stance exactly; it does not reopen it.

## The design space

**Option A — push, via the observer hook.** Feed committed events to a read-side processor through the observability `hook`. **Rejected:** the observer is fire-and-forget and explicitly drops throws/rejections (by design — telemetry must never break a write). A read model built on it would silently miss events. Observability ≠ integration; we already say so in REFINEMENTS E1.

**Option B — pure consumer concern.** Document the pattern, ship nothing. **Rejected for v1:** "you're on your own" is the gap. We can do better without overreaching.

**Option C — a catch-up subscription over an ordered feed (chosen).** The classic, correct event-sourcing shape:

1. An adapter advertises a **feed** capability: read all events across streams in global order, after a cursor.
2. A **read model** is a pure fold definition — like a projection, but over a flat event sequence from many streams, with an _explicit initial state_ (there's no single creating event to establish the shape — see below).
3. A **processor** catches the read model up: load its checkpoint + state, pull the feed since the cursor, fold the new events, save state + cursor. **Resumable** (the cursor is a durable checkpoint) and **idempotent** (re-running when nothing new has arrived folds nothing).

This keeps the pieces honest and composable: the fold is pure mechanism (no storage), the feed is an optional storage capability, the processor wires them with a checkpoint — exactly the layering the rest of the library uses.

## Key design decisions

- **Read models have an _explicit_ `initial` state — the opposite of projections.** A single-stream projection relies on its creating event (`*.opened`) to establish the full shape (the "first folded event establishes the shape" contract). A cross-stream read model has **no** creating event — it exists before any stream does (an empty list, an empty index). So it _must_ be seeded explicitly: `readModel(name, schema, initial)`. This asymmetry is a feature, not an inconsistency — it falls directly out of "one stream has a beginning; the firehose does not."
- **Handlers key off the event definition, not a topic string** — same as projections, so `event.payload` stays fully typed. Handlers also get `event.aggregate` (which stream this came from) — that's how a cross-stream model knows _which_ order/document it's folding.
- **The feed cursor is opaque and adapter-defined.** v1 models it as a monotonic integer; an adapter is free to make it a sequence number, a `(timestamp, tiebreak)`, or an oplog token. The processor only stores and replays it — it never interprets it.
- **At-least-once, idempotent folds.** The processor guarantees every event is folded _at least_ once; a crash between fold and checkpoint-save replays the last batch. Folds must therefore be **idempotent under replay** — which a pure fold keyed by topic naturally is, _provided_ handlers are written idempotently (e.g. set-by-key, not increment-blindly across a replayed batch). Documented as a consumer obligation, not magicked away.
- **The read model is validated against its Zod schema on save**, like a stored projection — a malformed fold fails loudly.

## What v1 ships

In `@hilaryosborne/sourcing-persistence`:

- `readModel(name, schema, initial)` + `.on(eventDef, handler)` + `.fold(events, from?)` — the pure cross-stream fold.
- `StorageFeedI` — the optional adapter capability: `readFeed(after, limit)`.
- `ReadModelStoreI` + `StoredReadModelV1` — checkpoint + state persistence.
- `processor({ feed, store })` + `.catchUp(model)` — the resumable catch-up subscription.

Proven against an in-memory feed (multi-stream fold, incremental catch-up, resumability). **Not** in v1: real-adapter feed implementations (Postgres global sequence, Mongo change stream), and an in-memory read-side store shipped for consumers.

## Open questions (the honest backfill)

1. **GDPR × cross-stream read models. — RESOLVED (v1), with a known cost.** This was the sharpest open problem; it's now closed end to end (`processor.rebuild` + `forget.cross-stream.test.ts`). Two halves:
   - **The feed reflects redactions.** The fix was to make the feed read **current event state** — a resumable QUERY over the stored events, ordered by a stable global cursor — _not_ an append-only copy and crucially _not_ a change-stream tail (a change stream emits the immutable original insert and would never reflect a later redaction — a real trap for adapter authors, now flagged on `StorageFeedI`). `forget` overwrites in place; the feed re-reads the address and serves the redacted payload.
   - **The read model is re-folded.** Because a cross-stream read model isn't stream-bound, `forget`'s `deleteProjections(stream)` can't reach it — and `catchUp` only folds _new_ events, so it leaves already-derived PII in place (the trap, proven in the test). The fix is `processor.rebuild(model)`: discard the checkpoint and re-fold the whole, now-redacted feed from zero. Since the repository can't enumerate read models, **rebuilding affected read models after a forget is the consumer's completion obligation** — the same shape as `forget`'s own "re-run until done."
   - **Known cost (the honest remaining edge):** `rebuild` is a full cross-stream replay — O(entire feed). For a large feed that's expensive, and v1 offers no cheaper path. A targeted re-fold (replay only the forgotten stream's redacted events) is correct only for idempotent set-by-key read models, not general folds, so it isn't a safe general mechanism. Cheaper invalidation (snapshots, partition-by-source) is future work. **For now: cross-stream read models holding PII are GDPR-safe via `rebuild`, at full-replay cost.**
2. **Exactly-once vs at-least-once.** v1 is at-least-once + idempotent-by-obligation. A consumer wanting exactly-once needs the checkpoint-save and the read-model-write in one transaction (same store) — an adapter capability we haven't specified.
3. **Feed semantics under concurrent commits.** "Global order" on Postgres via a sequence has a known gap: a sequence value can be assigned before its row is visible, so a naive `id > cursor` feed can skip events committed out-of-order. The real Postgres feed must handle this (the standard fix is a visibility/low-water-mark check). Recorded so it's designed, not discovered under load.
4. **Where read-model state lives.** v1 puts it behind `ReadModelStoreI` (its own destination). Whether that colocates with projections or is independently configured is a destinations question.
5. **Backpressure / batch sizing / running the processor.** v1 exposes `catchUp` (pull, on demand). A long-running daemon, scheduling, and backpressure are the consumer's to drive for now.

## Why this shape is right even if v1 is incomplete

Every piece is independently honest: the fold is pure and testable with no storage; the feed is an _optional_ capability that doesn't touch the S3-honest core port; the processor is a thin, resumable wire between them. Nothing here forces a decision the storage triangulation refuses. The hard parts that remain (GDPR, exactly-once, the Postgres visibility gap) are real and recorded — not papered over.
