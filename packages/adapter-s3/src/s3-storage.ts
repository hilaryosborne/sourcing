// The StorageI implementation over an S3ClientPort — the brutal adapter that proves the port
// (FOUNDATION §"Storage adapter scope": if it works on S3 it works anywhere). The
// load-bearing shapes (etag-CAS append, overwrite-by-position) are conformance-certified
// against MinIO via the StorageI conformance suite. No real S3 client here — the port is
// injected.
//
// ── BUCKET + DESTINATIONS ─────────────────────────────────────────────────────────────────
// The BUCKET is store identity, fixed at construction (the S3 analogue of the Postgres
// connection): one s3Storage instance = one bucket. The DESTINATION is a PREFIX within that
// bucket (events → "aggregates", projections → "projections"), configurable per the §3
// non-prohibition seam. Same-bucket-different-prefix is configurable; spanning buckets is
// SPREAD, the consumer's concern (FOUNDATION §"Configurable destinations"). The prefix is
// validated per-adapter (S3 allows `/`); resolved once (registry → events value, unused here).
//
// ── SINGLE-FILE LAYOUT ──────────────────────────────────────────────────────────────────
// One object per aggregate holds the WHOLE event stream:
//   {events-prefix}/{stream.name}/{stream.id}.json   → { events: EventEnvelopeV1Type[] }
// A reader GETs the entire stream in ONE shot, so a stream read is ATOMIC — no window where a
// list races an in-flight commit. Cost is real and recorded (unbounded growth; no cheap
// delta). Projections stay SEPARATE mutable objects (snapshot declined; the event object's
// etag means exactly "event stream version"; the B-ruling is untouched).
import type { EventEnvelopeV1Type } from "@hilaryosborne/sourcing";
import type {
  Destinations,
  StorageI,
  StorageStream,
  StoredProjectionV1Type,
} from "@hilaryosborne/sourcing-persistence";
import { resolveDestinations, StorageErrors, StoredProjectionV1 } from "@hilaryosborne/sourcing-persistence";
import type { AggregateKey, ProjectionKey, S3ClientPort } from "./s3-client";

// Batteries-included default prefixes; the consumer overrides any kind at construction.
const DEFAULT_DESTINATIONS: Destinations = { events: "aggregates", projections: "projections" };

// S3 prefix guard (per-adapter — S3's legal-name rules differ from Postgres's): one or more
// path segments of safe chars, single-slash separated, no leading/trailing slash (would break
// key composition). Allows nesting like "data/aggregates". Fail fast at construction.
const S3_PREFIX = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;
const asPrefix = (name: string): string => {
  if (!S3_PREFIX.test(name)) throw new Error(`invalid S3 destination prefix: ${JSON.stringify(name)}`);
  return name;
};

// The bucket — store identity, fixed at construction. Not a Destination (that would be spread).
export interface S3Config {
  bucket: string;
}

// The aggregate object's shape: the whole event stream in one object.
interface AggregateObject {
  events: EventEnvelopeV1Type[];
}

const headOf = (events: EventEnvelopeV1Type[]): number | undefined =>
  events.length ? Math.max(...events.map((event) => event.position)) : undefined;

export const s3Storage = (s3: S3ClientPort, config: S3Config, destinations: Partial<Destinations> = {}): StorageI => {
  const { bucket } = config;
  const dest = resolveDestinations({ ...DEFAULT_DESTINATIONS, ...destinations });
  const eventsRoot = asPrefix(dest.events);
  const projectionsRoot = asPrefix(dest.projections);
  // dest.registry is unused: head reads the event object (the registry is a view, Gate 2).

  const aggregateKey = (stream: StorageStream): AggregateKey =>
    `${eventsRoot}/${stream.name}/${stream.id}.json` as AggregateKey;
  const projectionsPrefix = (stream: StorageStream): string => `${projectionsRoot}/${stream.name}/${stream.id}/`;
  const projectionKey = (stream: StorageStream, name: string): ProjectionKey =>
    `${projectionsPrefix(stream)}${name}.json` as ProjectionKey;

  // The internal atomic read: the one aggregate object's parsed events + the etag for the next
  // conditional write. undefined if the stream has no object yet.
  const readObject = async (
    stream: StorageStream,
  ): Promise<{ events: EventEnvelopeV1Type[]; etag: string } | undefined> => {
    const got = await s3.get(bucket, aggregateKey(stream));
    if (!got) return undefined;
    const parsed = JSON.parse(got.body) as AggregateObject;
    return { events: parsed.events, etag: got.etag };
  };

  return {
    head: async (stream) => {
      const obj = await readObject(stream);
      return obj ? headOf(obj.events) : undefined;
    },

    read: async (stream, after) => {
      const obj = await readObject(stream);
      const events = obj ? [...obj.events].sort((a, b) => a.position - b.position) : [];
      return after === undefined ? events : events.filter((event) => event.position > after);
    },

    // ── etag-CAS APPEND ───────────────────────────────────────────────────────────────────
    append: async (stream, events, expectedHead) => {
      if (events.length === 0) {
        // Empty append honors expectedHead (Reading B): the compare is a precondition asserted
        // whenever given, not a write-guard. Nothing to write, but a stale expectedHead conflicts.
        if (expectedHead === undefined) return;
        const head = await readObject(stream).then((obj) => (obj ? headOf(obj.events) : undefined));
        if (head !== expectedHead) throw new Error(StorageErrors.VERSION_CONFLICT);
        return;
      }

      // Contiguity precondition — LOAD-BEARING under single-file: its OWN error (caller bug),
      // distinct from VERSION_CONFLICT, because the key no longer encodes position.
      const expectedStart = (expectedHead ?? -1) + 1;
      if (events[0]!.position !== expectedStart) throw new Error(StorageErrors.APPEND_NOT_CONTIGUOUS);

      const obj = await readObject(stream);
      if (obj === undefined) {
        // Creating the stream — first-write-wins via If-None-Match: *.
        if (expectedHead !== undefined) throw new Error(StorageErrors.VERSION_CONFLICT);
        const created = await s3.putIfAbsent(bucket, aggregateKey(stream), JSON.stringify({ events }));
        if (!created) throw new Error(StorageErrors.VERSION_CONFLICT);
        return;
      }

      // Appending — two guards, both VERSION_CONFLICT: head === expectedHead (load→commit
      // gap) AND putIfMatch(etag) (re-read→write race; prevents clobbering a concurrent write).
      if (headOf(obj.events) !== expectedHead) throw new Error(StorageErrors.VERSION_CONFLICT);
      const merged: AggregateObject = { events: [...obj.events, ...events] };
      const written = await s3.putIfMatch(bucket, aggregateKey(stream), JSON.stringify(merged), obj.etag);
      if (!written) throw new Error(StorageErrors.VERSION_CONFLICT);
    },

    // ── OVERWRITE BY (stream, position) ───────────────────────────────────────────────────
    // Read the one object, strip targeted positions in memory, write the whole object back
    // under If-Match. Position miss → OVERWRITE_UNKNOWN_POSITION (by position, never uid).
    // Concurrent forget: the second writer's etag is stale → rejected (VERSION_CONFLICT) →
    // retries against the new etag, re-reads the partially-redacted object, re-strips, writes.
    // Convergent under retry.
    overwrite: async (stream, redactions) => {
      const obj = await readObject(stream);
      if (obj === undefined) {
        if (redactions.length > 0) throw new Error(StorageErrors.OVERWRITE_UNKNOWN_POSITION);
        return;
      }
      const events = [...obj.events];
      for (const redacted of redactions) {
        const index = events.findIndex((event) => event.position === redacted.position);
        if (index === -1) throw new Error(StorageErrors.OVERWRITE_UNKNOWN_POSITION);
        events[index] = redacted;
      }
      const written = await s3.putIfMatch(bucket, aggregateKey(stream), JSON.stringify({ events }), obj.etag);
      if (!written) throw new Error(StorageErrors.VERSION_CONFLICT);
    },

    // Projections: one mutable object per (stream, name). Parse the universal model on the way
    // IN (the adapter is the boundary where backend bytes become StoredProjection).
    loadProjection: async (stream, name) => {
      const got = await s3.get(bucket, projectionKey(stream, name));
      return got ? (StoredProjectionV1.parse(JSON.parse(got.body)) as StoredProjectionV1Type) : undefined;
    },

    saveProjection: async (stored) => {
      await s3.put(bucket, projectionKey(stored.aggregate, stored.name), JSON.stringify(stored));
    },

    // Bin every projection for the stream — at the configured PROJECTION prefix, never one
    // derived from the event location (forget's bin-all thread-through).
    deleteProjections: async (stream) => {
      const keys = await s3.list(bucket, projectionsPrefix(stream));
      if (keys.length > 0) await s3.delete(bucket, keys);
    },
  };
};
