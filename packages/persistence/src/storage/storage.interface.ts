// DRAFT — Epic 4, Phase A (redraft). THE STORAGE INTERFACE — the seam every adapter
// (Postgres, Mongo, S3) implements; the load-bearing contract of the whole storage story.
// Drafted against all three reference adapters at once: if S3 can't honestly implement it,
// it is wrong (FOUNDATION §"Storage adapter scope"). Shapes under review; awaiting
// per-artefact ratification (DRAFT-AND-HALT.md). This file is interface ONLY — base +
// concrete are Phase C, built per-backend after ratification.
//
// SPREAD-STORAGE CAVEAT (FOUNDATION / Hilary's ruling): a backend may be a single database,
// duplicated, or one aggregate's data split across several stores/technologies. So the port
// makes NO colocation or cross-entity-transaction assumptions — every operation stands on
// its own. The events and projections halves are segregated; one adapter implements both,
// but they are independent operations, each S3-honest (put / get / list-by-prefix / delete).
import type { EventEnvelopeV1Type } from "@hilaryosborne/sourcing";
import type { StorageStream, StoredProjectionV1Type } from "./storage.model";

// --- The event store -------------------------------------------------------------------
// Everything an adapter must do with events. What is NOT here: no query language, no joins,
// no server-side projection, no subscriptions — those need one store's special powers and
// stay out of the shared contract (or become optional advertised capabilities).
export interface StorageEventsI {
  // The cheap registry read: the highest stored position in this stream, or undefined for
  // an unknown/empty stream. This is what the aggregate registry is BACKED BY — a single
  // lookup, never a full-stream scan. It is what lets Scenario 2 skip the delta fetch
  // entirely when a projection is already current (FOUNDATION §Scenario 2).
  head(stream: StorageStream): Promise<number | undefined>;

  // Read a stream's events in position order. `after` is EXCLUSIVE: omit it for the full
  // stream from position 0; pass a projection's bookmark to get only the delta (events with
  // position > after). One call serves both the full-build and delta-build outcomes of
  // self-healing — same call, different starting point.
  read(stream: StorageStream, after?: number): Promise<EventEnvelopeV1Type[]>;

  // Append committed event envelopes to a stream (the repository persisting a commit). The
  // envelopes already carry their stream-local positions (core assigned them at staging).
  //
  // `expectedHead` is the optimistic-concurrency guard — a MANDATORY capability of every
  // adapter (FOUNDATION §"Single adapter per repository"): if given and it does not match
  // the stream's current head, throw VERSION_CONFLICT and append nothing (all-or-nothing
  // compare-and-append; FOUNDATION §Events: concurrency is the repository's job). The guard
  // compares against THIS adapter's head, never a global head. `expectedHead` is OPTIONAL at
  // the call site — a blind append is allowed — but the compare-and-append capability is not
  // optional. S3 emulates it behind the port via conditional writes / preconditions; ugly is
  // fine, absent is not.
  append(stream: StorageStream, events: EventEnvelopeV1Type[], expectedHead?: number): Promise<void>;

  // ⚠ SANCTIONED EXCEPTION TO IMMUTABILITY — the ONLY non-append-only operation in this
  // entire port. It exists SOLELY for right-to-forget / erasure. It is NOT a general-purpose
  // update: do NOT reach for it to "fix a bad event," amend a payload, or rewrite history.
  // Events are immutable; this is the one carved-out exception, and using it for anything
  // but erasure turns that guarantee into a mere guideline. To correct a fact, append a new
  // event — never overwrite the old one.
  //
  // Right-to-forget: OVERWRITE events in place with their redacted payloads, preserving each
  // event's identity and metadata (FOUNDATION §Strippers). The operation that pressure-tests
  // the port hardest: trivial in Postgres/Mongo (UPDATE / replaceOne), but on S3 it means
  // REWRITING whichever object holds the event — and if events are batched per object,
  // rewriting the whole batch (FOUNDATION §"Right-to-forget and the storage interface").
  //
  // The match key is `(stream, position)` (FOUNDATION §"Single adapter per repository"):
  // within one adapter, position is the unambiguous address of a historical fact. The event
  // `id`/uid is the key for append-time dedup/idempotency, NOT the overwrite key — do not
  // implement overwrite as a uid scan-to-find. A `(stream, position)` that matches no stored
  // event → StorageErrors.OVERWRITE_UNKNOWN_POSITION.
  overwrite(stream: StorageStream, events: EventEnvelopeV1Type[]): Promise<void>;
}

// --- The projection store --------------------------------------------------------------
// Load / save / delete a stored projection (state + bookmark), keyed by (stream, name).
export interface StorageProjectionsI {
  // Fetch the stored projection for (stream, name), or undefined if none has been built.
  // Undefined drives the "no stored projection → full build" outcome of self-healing.
  loadProjection(stream: StorageStream, name: string): Promise<StoredProjectionV1Type | undefined>;

  // Upsert a stored projection by its (aggregate, name). Overwrites the previous state and
  // bookmark.
  saveProjection(stored: StoredProjectionV1Type): Promise<void>;

  // Delete EVERY stored projection for a stream — an ADAPTER CAPABILITY, not a repository-
  // baked prefix scan (FOUNDATION §"Single adapter per repository"). This is what right-to-
  // forget uses to bin the read side after overwriting events: because overwrite does NOT
  // move the head, a "current" projection (head === bookmark) would otherwise be served from
  // cache and mask the erasure — so forget bins all projections, and the next rebuild does a
  // clean full build from the now-redacted events. The port states the WHAT ("remove every
  // projection for this stream"); the adapter owns the HOW — our adapters colocate a stream's
  // projections and delete by prefix; a consumer who spreads projections supplies their own
  // cleanup behind this same seam.
  deleteProjections(stream: StorageStream): Promise<void>;
}

// The whole store: what one backend adapter implements end to end. Named type, not a
// default export (verbatimModuleSyntax forbids default-exporting a type).
export interface StorageI extends StorageEventsI, StorageProjectionsI {}
