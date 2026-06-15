// The StorageI implementation over a MongoClientPort — the interesting MIDDLE between S3 and
// Postgres. It expresses the SAME contract both extremes do, and is conformance-certified
// against a real Mongo replica set. No real `mongodb` here — the port is injected.
//
// MODEL: one document per event in the events collection, keyed by a UNIQUE INDEX on
// (stream_name, stream_id, position) — that index is the compare-and-append (like Postgres's
// PK). Cheap delta read via an indexed find (like Postgres). The strain is ATOMICITY: Mongo
// has no single-statement multi-document write, so a multi-event append and a multi-position
// overwrite are wrapped in a TRANSACTION for all-or-nothing. The port holds; the deployment
// floor (replica set) is higher. (Alternative considered: whole-stream-in-one-document with a
// conditional $push — atomic without transactions, but S3-like, no cheap delta, 16MB cap — the
// S3 end, not the middle.)
//
// DESTINATIONS: collection-as-destination (events / projections), per-adapter name-validated.
import type { EventEnvelopeV1Type } from "@hilaryosborne/sourcing";
import type {
  Destinations,
  StorageI,
  StorageStream,
  StoredProjectionV1Type,
} from "@hilaryosborne/sourcing-persistence";
import { resolveDestinations, StorageErrors, StoredProjectionV1 } from "@hilaryosborne/sourcing-persistence";
import type { MongoClientPort } from "./mongo-client";
import { isDuplicateKey } from "./mongo-client";

const DEFAULT_DESTINATIONS: Destinations = { events: "sourcing_events", projections: "sourcing_projections" };

// Mongo collection-name guard (per-adapter — Mongo's rules differ again): a conservative safe
// charset, no "$", not reserved "system.*". Fail fast at construction.
const COLLECTION_NAME = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
const asCollectionName = (name: string): string => {
  if (!COLLECTION_NAME.test(name) || name.startsWith("system."))
    throw new Error(`invalid Mongo collection name: ${JSON.stringify(name)}`);
  return name;
};

type EventDoc = { stream_name: string; stream_id: string; position: number; envelope: EventEnvelopeV1Type };
type ProjectionDoc = { stream_name: string; stream_id: string; name: string; position: number; state: unknown };

const streamFilter = (stream: StorageStream) => ({ stream_name: stream.name, stream_id: stream.id });

// ASYNC factory: the (stream, position) unique index IS the compare-and-append, so it is a
// PRECONDITION, not setup boilerplate. Ensuring it here makes it non-optional — an un-indexed
// collection (where insertMany would SUCCEED on a duplicate position, silently voiding the CAS
// and passing every test against a properly-indexed collection) cannot be reached through this
// constructor. Idempotent; this is the ONLY construction path (no separate, skippable setup).
export const mongoStorage = async (
  mongo: MongoClientPort,
  destinations: Partial<Destinations> = {},
): Promise<StorageI> => {
  const dest = resolveDestinations({ ...DEFAULT_DESTINATIONS, ...destinations });
  const eventsCollection = asCollectionName(dest.events);
  const projectionsCollection = asCollectionName(dest.projections);
  // dest.registry unused: head reads the events collection (the registry is a view, Gate 2).

  await mongo.ensureUniqueIndex(eventsCollection, { stream_name: 1, stream_id: 1, position: 1 });
  await mongo.ensureUniqueIndex(projectionsCollection, { stream_name: 1, stream_id: 1, name: 1 });

  return {
    head: async (stream) => {
      const docs = await mongo.find<EventDoc>(eventsCollection, streamFilter(stream), {
        sort: { position: -1 },
        limit: 1,
      });
      return docs[0]?.position;
    },

    // Cheap delta read via the indexed find — same read() contract as the other adapters.
    read: async (stream, after) => {
      const filter = after === undefined ? streamFilter(stream) : { ...streamFilter(stream), position: { $gt: after } };
      const docs = await mongo.find<EventDoc>(eventsCollection, filter, { sort: { position: 1 } });
      return docs.map((doc) => doc.envelope);
    },

    // ── ① CONCURRENCY ─────────────────────────────────────────────────────────────────────
    // The unique index (stream, position) is the compare-and-append. insertMany INSIDE a
    // transaction makes the multi-event commit ALL-OR-NOTHING (the document model's strain:
    // no single-statement multi-doc atomicity). A position already taken → duplicate key
    // (11000) → the transaction aborts → VERSION_CONFLICT, nothing inserted. expectedHead is
    // enforced structurally by the events' positions + the unique key — same MEANING as S3 and
    // Postgres, the mechanism is "unique index + transaction". APPEND_NOT_CONTIGUOUS stays its
    // own non-retryable error (the index enforces no-duplicate, not no-gap).
    append: async (stream, events, expectedHead) => {
      if (events.length === 0) {
        // Empty append honors expectedHead (Reading B): the compare is a precondition asserted
        // whenever given, not a write-guard. Nothing to write, but a stale expectedHead conflicts.
        if (expectedHead === undefined) return;
        const docs = await mongo.find<EventDoc>(eventsCollection, streamFilter(stream), {
          sort: { position: -1 },
          limit: 1,
        });
        const head = docs[0]?.position;
        if (head !== expectedHead) throw new Error(StorageErrors.VERSION_CONFLICT);
        return;
      }
      const expectedStart = (expectedHead ?? -1) + 1;
      if (events[0]!.position !== expectedStart) throw new Error(StorageErrors.APPEND_NOT_CONTIGUOUS);
      const docs: EventDoc[] = events.map((event) => ({
        stream_name: stream.name,
        stream_id: stream.id,
        position: event.position,
        envelope: event,
      }));
      try {
        await mongo.transaction((tx) => tx.insertMany(eventsCollection, docs));
      } catch (error) {
        if (isDuplicateKey(error)) throw new Error(StorageErrors.VERSION_CONFLICT);
        throw error;
      }
    },

    // ── ② OVERWRITE BY (stream, position) ─────────────────────────────────────────────────
    // Per-position updateOne INSIDE a transaction → ALL-OR-NOTHING: a miss (no doc matched)
    // throws → the transaction aborts → every redaction rolls back → OVERWRITE_UNKNOWN_POSITION
    // with the stream untouched (observably identical to S3 and Postgres). Matched by position,
    // never a uid scan. Sequential updates in the transaction are deterministic (no
    // duplicate-driven nondeterminism); positions are unique by construction (forget redacts
    // each event once). Cleaner than Postgres's CTE here — but it COSTS a transaction, which
    // Postgres did not need. That is the middle.
    overwrite: async (stream, redactions) => {
      if (redactions.length === 0) return;
      await mongo.transaction(async (tx) => {
        for (const redacted of redactions) {
          const matched = await tx.updateOne(
            eventsCollection,
            { stream_name: stream.name, stream_id: stream.id, position: redacted.position },
            { envelope: redacted },
          );
          if (!matched) throw new Error(StorageErrors.OVERWRITE_UNKNOWN_POSITION);
        }
      });
    },

    loadProjection: async (stream, name) => {
      const docs = await mongo.find<ProjectionDoc>(
        projectionsCollection,
        { ...streamFilter(stream), name },
        { limit: 1 },
      );
      const doc = docs[0];
      if (!doc) return undefined;
      return StoredProjectionV1.parse({
        aggregate: { id: stream.id, name: stream.name },
        name,
        position: doc.position,
        state: doc.state,
      }) as StoredProjectionV1Type;
    },

    saveProjection: async (stored) => {
      const filter = { stream_name: stored.aggregate.name, stream_id: stored.aggregate.id, name: stored.name };
      await mongo.upsertOne(projectionsCollection, filter, {
        ...filter,
        position: stored.position,
        state: stored.state,
      });
    },

    // Bin every projection for the stream — at the configured PROJECTION collection, never one
    // derived from the event location (forget's bin-all thread-through).
    deleteProjections: async (stream) => {
      await mongo.deleteMany(projectionsCollection, streamFilter(stream));
    },
  };
};
