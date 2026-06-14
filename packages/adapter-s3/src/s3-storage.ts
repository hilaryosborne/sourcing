// DRAFT — Epic 4, Phase C (S3 adapter). The StorageI implementation over an S3ClientPort —
// the brutal adapter that proves the ratified port (FOUNDATION §"Storage adapter scope": if
// it works on S3 it works anywhere). Awaiting per-artefact ratification of the load-bearing
// shapes (etag-CAS append, overwrite-by-position) BEFORE the conformance suite locks the
// contract. No real S3 client here — the port is injected.
//
// ── SINGLE-FILE LAYOUT ──────────────────────────────────────────────────────────────────
// One object per aggregate holds the WHOLE event stream:
//   aggregates/{stream.name}/{stream.id}.json   → { events: EventEnvelopeV1Type[] }
// This exists for CORRECTNESS, not simplicity: a reader GETs the entire stream in ONE shot,
// so there is no window where a list races an in-flight commit and observes a half-written
// stream (FOUNDATION §"S3 adapter — single-file for atomic reads"). The cost is real and
// recorded: every commit rewrites the whole object (unbounded growth), and there is no cheap
// delta read on S3.
//
// Projections stay SEPARATE, mutable objects (no snapshot is folded into the aggregate
// object — that keeps the projection half decoupled from the event object's etag, and keeps
// any storage concept out of core; the B-ruling is untouched):
//   projections/{stream.name}/{stream.id}/{projectionName}.json  → StoredProjectionV1
import type { EventEnvelopeV1Type } from "@hilaryosborne/sourcing";
import type { StorageI, StorageStream, StoredProjectionV1Type } from "@hilaryosborne/sourcing-persistence";
import { StorageErrors, StoredProjectionV1 } from "@hilaryosborne/sourcing-persistence";
import type { AggregateKey, ProjectionKey, S3ClientPort } from "./s3-client";

// The single sanctioned place each branded key is minted. The brand then flows through the
// type system, so the event object can only reach the CAS ops and projections can only reach
// the unconditional put.
const aggregateKey = (stream: StorageStream): AggregateKey =>
  `aggregates/${stream.name}/${stream.id}.json` as AggregateKey;
const projectionsPrefix = (stream: StorageStream): string => `projections/${stream.name}/${stream.id}/`;
const projectionKey = (stream: StorageStream, name: string): ProjectionKey =>
  `${projectionsPrefix(stream)}${name}.json` as ProjectionKey;

// The aggregate object's shape: the whole event stream in one object.
interface AggregateObject {
  events: EventEnvelopeV1Type[];
}

const headOf = (events: EventEnvelopeV1Type[]): number | undefined =>
  events.length ? Math.max(...events.map((event) => event.position)) : undefined;

export const s3Storage = (s3: S3ClientPort): StorageI => {
  // The internal atomic read: the one aggregate object's parsed events + the etag for the
  // next conditional write. undefined if the stream has no object yet. This single GET is
  // what makes the stream read atomic.
  const readObject = async (
    stream: StorageStream,
  ): Promise<{ events: EventEnvelopeV1Type[]; etag: string } | undefined> => {
    const got = await s3.get(aggregateKey(stream));
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

    // ── etag-CAS APPEND (flagged for ratification) ────────────────────────────────────────
    append: async (stream, events, expectedHead) => {
      if (events.length === 0) return;

      // Contiguity precondition — LOAD-BEARING under single-file. The key no longer encodes
      // position, so nothing else checks that the staged events follow the expected head; a
      // mis-sequenced append would pass the etag check and corrupt the stream. Its OWN error
      // (a caller bug), distinct from VERSION_CONFLICT (a concurrency loss). Single-file
      // RAISED this from belt-and-suspenders to the only contiguity guard there is.
      const expectedStart = (expectedHead ?? -1) + 1;
      if (events[0]!.position !== expectedStart) throw new Error(StorageErrors.APPEND_NOT_CONTIGUOUS);

      const obj = await readObject(stream);
      if (obj === undefined) {
        // Creating the stream — first-write-wins via If-None-Match: *. You cannot expect a
        // head on a stream that does not exist.
        if (expectedHead !== undefined) throw new Error(StorageErrors.VERSION_CONFLICT);
        const created = await s3.putIfAbsent(aggregateKey(stream), JSON.stringify({ events }));
        if (!created) throw new Error(StorageErrors.VERSION_CONFLICT);
        return;
      }

      // Appending. Two guards, both surfacing VERSION_CONFLICT:
      //   1. head still equals expectedHead → catches the load→commit gap (another commit
      //      landed since the caller loaded).
      //   2. write conditioned on the etag → catches a concurrent writer landing between THIS
      //      read and the write (prevents clobbering it). Guard 1 alone is not enough,
      //      because this read already observed the fresh etag.
      if (headOf(obj.events) !== expectedHead) throw new Error(StorageErrors.VERSION_CONFLICT);
      const merged: AggregateObject = { events: [...obj.events, ...events] };
      const written = await s3.putIfMatch(aggregateKey(stream), JSON.stringify(merged), obj.etag);
      if (!written) throw new Error(StorageErrors.VERSION_CONFLICT);
    },

    // ── OVERWRITE BY (stream, position) (flagged for ratification) ────────────────────────
    // Single-file's clean win: read the one object, strip the targeted positions in memory,
    // write the whole object back under If-Match. One read, one conditional write — no
    // find-the-batch/rewrite-the-batch. Position miss → OVERWRITE_UNKNOWN_POSITION (matched
    // by position, never a uid scan). Concurrent forget: the second writer's etag is stale →
    // REJECTED (VERSION_CONFLICT), not silently lost; it retries against the new etag,
    // re-reads the partially-redacted object, re-strips its own positions, writes. Convergent
    // under retry — the right-to-forget completion property holds.
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
      const written = await s3.putIfMatch(aggregateKey(stream), JSON.stringify({ events }), obj.etag);
      if (!written) throw new Error(StorageErrors.VERSION_CONFLICT);
    },

    // Projections: one mutable object per (stream, name). Parse the universal model on the way
    // IN (the adapter is the boundary where backend bytes become StoredProjection — "parse
    // your store's reads"); trust the typed value on the way out.
    loadProjection: async (stream, name) => {
      const got = await s3.get(projectionKey(stream, name));
      return got ? (StoredProjectionV1.parse(JSON.parse(got.body)) as StoredProjectionV1Type) : undefined;
    },

    saveProjection: async (stored) => {
      await s3.put(projectionKey(stored.aggregate, stored.name), JSON.stringify(stored));
    },

    // Bin every projection for the stream by deleting the whole colocated prefix.
    deleteProjections: async (stream) => {
      const keys = await s3.list(projectionsPrefix(stream));
      if (keys.length > 0) await s3.delete(keys);
    },
  };
};
