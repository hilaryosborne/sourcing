// An in-memory StorageI test double — for PROVING the persistence layer end to end without
// a real backend (Phase C ships the real Postgres/Mongo/S3 adapters). Not shipped: a
// __tests__ helper that models the ratified port faithfully, including the two mechanical
// errors (VERSION_CONFLICT, OVERWRITE_UNKNOWN_POSITION) and the (stream, position) overwrite
// key. Single-store, in-memory — the "single adapter per repository" default.
import type { EventEnvelopeV1Type } from "@hilaryosborne/sourcing";
import type { StorageI } from "../storage/storage.interface";
import type { StorageStream, StoredProjectionV1Type } from "../storage/storage.model";
import { StorageErrors } from "../storage/storage.errors";

const key = (stream: StorageStream): string => `${stream.name}/${stream.id}`;
const headOf = (events: EventEnvelopeV1Type[]): number | undefined =>
  events.length ? Math.max(...events.map((event) => event.position)) : undefined;

export const memoryStorage = (): StorageI => {
  const streams = new Map<string, EventEnvelopeV1Type[]>();
  const projections = new Map<string, Map<string, StoredProjectionV1Type>>();

  return {
    head: async (stream) => headOf(streams.get(key(stream)) ?? []),

    read: async (stream, after) => {
      const all = [...(streams.get(key(stream)) ?? [])].sort((a, b) => a.position - b.position);
      return after === undefined ? all : all.filter((event) => event.position > after);
    },

    append: async (stream, incoming, expectedHead) => {
      const k = key(stream);
      const current = streams.get(k) ?? [];
      // Reading B: expectedHead is the expected version — asserted whenever given, empty batches
      // included (the compare in compare-and-append is a precondition, not a write-guard).
      if (expectedHead !== undefined && headOf(current) !== expectedHead)
        throw new Error(StorageErrors.VERSION_CONFLICT);
      if (incoming.length === 0) return;
      // Contiguity: the staged events must follow expectedHead. Its own error (caller bug, not a
      // concurrency loss) — and load-bearing, since position-uniqueness catches duplicates, not gaps.
      if (incoming[0]!.position !== (expectedHead ?? -1) + 1) throw new Error(StorageErrors.APPEND_NOT_CONTIGUOUS);
      // CAS backstop via position-uniqueness: a position is never written twice. This catches a
      // blind append at a taken position (e.g. a second create, where expectedHead is omitted).
      const taken = new Set(current.map((event) => event.position));
      if (incoming.some((event) => taken.has(event.position))) throw new Error(StorageErrors.VERSION_CONFLICT);
      streams.set(k, [...current, ...incoming]);
    },

    overwrite: async (stream, redacted) => {
      const k = key(stream);
      const next = [...(streams.get(k) ?? [])];
      for (const event of redacted) {
        // The match key is (stream, position) — never a uid scan-to-find.
        const idx = next.findIndex((stored) => stored.position === event.position);
        if (idx === -1) throw new Error(StorageErrors.OVERWRITE_UNKNOWN_POSITION);
        next[idx] = event;
      }
      streams.set(k, next);
    },

    loadProjection: async (stream, name) => projections.get(key(stream))?.get(name),

    saveProjection: async (stored) => {
      const k = key(stored.aggregate);
      const byName = projections.get(k) ?? new Map<string, StoredProjectionV1Type>();
      byName.set(stored.name, stored);
      projections.set(k, byName);
    },

    // Bin every projection for the stream (our store colocates them under one key).
    deleteProjections: async (stream) => {
      projections.delete(key(stream));
    },
  };
};
