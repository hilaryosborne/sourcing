# 🧩 Write your own storage adapter

The library ships Postgres, Mongo, and S3 — but the seam is public, so any backend that can store and read ordered records can back it. You implement one interface, `StorageI`, and certify it against the same [conformance suite](/reference/api-persistence#conformance) the official adapters pass. This page builds a complete in-memory adapter end to end.

## The contract

`StorageI` is two halves — events and projections — seven methods total:

| Method                                  | Must do                                                                                                                                                                                                            |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `head(stream)`                          | Return the highest stored position, or `undefined` for an empty stream.                                                                                                                                            |
| `read(stream, after?)`                  | Events in position order; `after` is **exclusive**; omit it to read from the start.                                                                                                                                |
| `append(stream, events, expectedHead?)` | **Compare-and-append.** Reject with `VERSION_CONFLICT` if `expectedHead` doesn't match the current head; reject with `APPEND_NOT_CONTIGUOUS` if the first position isn't `expectedHead + 1`. Write all-or-nothing. |
| `overwrite(stream, events)`             | Replace payloads in place, matched by `(stream, position)`, **all-or-nothing**; `OVERWRITE_UNKNOWN_POSITION` if any position is missing. For erasure only.                                                         |
| `loadProjection(stream, name)`          | The stored projection, or `undefined`.                                                                                                                                                                             |
| `saveProjection(stored)`                | Upsert by `(aggregate, name)`.                                                                                                                                                                                     |
| `deleteProjections(stream)`             | Bin **every** projection for the stream.                                                                                                                                                                           |

Three invariants are load-bearing — get these right and the rest follows:

1. **`head` reflects appends, not overwrites.** An in-place redaction must _not_ move the head, or a "current" projection would be masked. ([self-healing →](/guide/repository#self-healing-the-rebuild-algorithm))
2. **`append` is a real compare-and-append.** This is the optimistic-concurrency guarantee the whole library leans on. On a real backend you map the native conflict — a Postgres unique-violation (`23505`), a Mongo duplicate-key (`11000`), an S3 `412` — to `VERSION_CONFLICT`.
3. **`overwrite` matches by `(stream, position)`**, never a payload scan, and is atomic across the whole batch.

## A complete in-memory adapter

Everything above, in ~40 lines — a faithful, working `StorageI` you can drop into a `repository` today (and the basis for testing your real one):

```ts
import type { EventEnvelopeV1Type } from "@hilaryosborne/sourcing";
import type { StorageI, StorageStream, StoredProjectionV1Type } from "@hilaryosborne/sourcing-persistence";
import { StorageErrors } from "@hilaryosborne/sourcing-persistence";

const key = (stream: StorageStream): string => `${stream.name}/${stream.id}`;
const headOf = (events: EventEnvelopeV1Type[]): number | undefined =>
  events.length ? Math.max(...events.map((e) => e.position)) : undefined;

export const memoryStorage = (): StorageI => {
  const streams = new Map<string, EventEnvelopeV1Type[]>();
  const projections = new Map<string, Map<string, StoredProjectionV1Type>>();

  return {
    head: async (stream) => headOf(streams.get(key(stream)) ?? []),

    read: async (stream, after) => {
      const all = [...(streams.get(key(stream)) ?? [])].sort((a, b) => a.position - b.position);
      return after === undefined ? all : all.filter((e) => e.position > after);
    },

    append: async (stream, incoming, expectedHead) => {
      const k = key(stream);
      const current = streams.get(k) ?? [];
      // expectedHead is a precondition — asserted whenever given, empty batches included.
      if (expectedHead !== undefined && headOf(current) !== expectedHead)
        throw new Error(StorageErrors.VERSION_CONFLICT);
      if (incoming.length === 0) return;
      // Contiguity is its own error (a caller bug, not a lost race).
      if (incoming[0]!.position !== (expectedHead ?? -1) + 1) throw new Error(StorageErrors.APPEND_NOT_CONTIGUOUS);
      // CAS backstop: a position is never written twice (catches a blind append at a taken slot).
      const taken = new Set(current.map((e) => e.position));
      if (incoming.some((e) => taken.has(e.position))) throw new Error(StorageErrors.VERSION_CONFLICT);
      streams.set(k, [...current, ...incoming]);
    },

    overwrite: async (stream, redacted) => {
      const k = key(stream);
      const next = [...(streams.get(k) ?? [])];
      for (const event of redacted) {
        const idx = next.findIndex((stored) => stored.position === event.position); // match by (stream, position)
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

    deleteProjections: async (stream) => {
      projections.delete(key(stream));
    },
  };
};
```

That's a real adapter — `repository({ storage: memoryStorage() })` works, conflicts and all. (It's also exactly the double the library's own tests drive the repository with.)

## Certify it

Don't trust an adapter you haven't run the contract against. `runConformance` is the shared suite — head advances, conflicts write nothing, overwrite is all-or-nothing, hostile keys (`$`-prefixed, dotted, unicode) round-trip, concurrent appends resolve to exactly one winner. You supply a fixture yielding a fresh, empty adapter:

```ts
import { runConformance } from "@hilaryosborne/sourcing-persistence";
import { memoryStorage } from "./memory-storage";

runConformance(async () => memoryStorage()); // same bar the Postgres/Mongo/S3 adapters clear
```

The suite never branches on adapter type — it asserts only contract facts. If your adapter passes it, it behaves identically to the shipped three from the library's point of view.

## Going to a real backend

Swap the maps for your store and keep the contract identical:

- **The unique key `(stream_name, stream_id, position)`** is your compare-and-append — a unique index/constraint, not application logic. Map its native violation to `VERSION_CONFLICT`.
- **Multi-event appends are all-or-nothing** — a single statement (Postgres), a transaction (Mongo), or an etag-conditional object write (S3).
- **`overwrite` is the one sanctioned mutation**, for right-to-forget only. It must be atomic across the batch.

See the [Postgres](/guide/adapter-postgres), [Mongo](/guide/adapter-mongo), and [S3](/guide/adapter-s3) adapters for three worked answers to those questions.

## ➡️ Next

- [API: persistence](/reference/api-persistence#storagei-the-storage-port) — exact signatures.
- [Storage adapters](/guide/storage-adapters) — the shipped three and how to choose.
- [Write your own observer](/guide/write-own-observer) — the other extension seam.
