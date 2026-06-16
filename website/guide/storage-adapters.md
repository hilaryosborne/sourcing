# 🔌 Storage adapters

Core has no storage. The [repository](/guide/repository) adds the stored, self-healing read/write path, talking to a **storage adapter** through one interface (`StorageI`). The library ships three reference adapters — Postgres, Mongo, S3 — and you can [write your own](/reference/api-persistence#conformance). You pick **one adapter per repository**.

The three reference adapters aren't arbitrary: they're a forcing function. Postgres is relational, Mongo is a document store, S3 is barely more than put/get/list. If one interface can be honestly implemented by all three, the interface is correct — and yours will fit too.

## Which adapter should I pick?

|                                | [🐘 Postgres](/guide/adapter-postgres)                     | [🍃 Mongo](/guide/adapter-mongo) | [🪣 S3](/guide/adapter-s3)                               |
| ------------------------------ | ---------------------------------------------------------- | -------------------------------- | -------------------------------------------------------- |
| **Cheap stale-delta reads**    | ✅ reads only the delta                                    | ✅ reads only the delta          | ❌ reads the whole object                                |
| **Multi-event atomicity**      | single `INSERT` statement                                  | transaction                      | single-object etag CAS                                   |
| **Operational requirement**    | a Postgres                                                 | a **replica set**                | a bucket                                                 |
| **Object growth**              | bounded                                                    | bounded                          | **unbounded** (whole stream per object)                  |
| **Optional cross-stream feed** | feasible                                                   | feasible                         | needs an external sequencer                              |
| **Pick it when…**              | the default — you want cheap deltas and a boring datastore | Mongo is already your store      | you want the simplest infra and streams aren't write-hot |

In short: **Postgres unless you have a reason.** Mongo if it's already your datastore (mind the replica set). S3 if you want object storage and accept that stale reads cost a full read. ([the honest S3 costs →](/guide/adapter-s3#constraints-trade-offs-structural-by-design))

## Compose the repository

```ts
import { repository } from "@hilaryosborne/sourcing-persistence";

const repo = repository({ storage }); // storage is a StorageI from one of the adapters
```

`repository({ storage })` wires the aggregate registry and projection store from that one adapter — you choose only the backend. The read/write surface (`create` / `load` / `commit` / `rebuild` / `forget`), the self-healing algorithm, and the retry loop are all on [The repository & self-healing](/guide/repository).

## The `StorageI` seam

Every adapter implements one interface: `head` / `read` / `append` / `overwrite` for events, and `loadProjection` / `saveProjection` / `deleteProjections` for projections. That's the entire contract between the library and any backend — see the [API reference](/reference/api-persistence#storagei-the-storage-port) for the exact signatures, and the [conformance suite](/reference/api-persistence#conformance) for how every adapter (including yours) is certified against it.

## Configurable destinations

Adapters take an optional `destinations` map telling each _kind_ where to live — an adapter reads each name as a table / collection / key-prefix:

```ts
{ events: "account_events", projections: "account_projections", registry?: "..." /* defaults to events */ }
```

The library targets **one destination per operation and never coordinates across destinations** — configurable, not coordinated. Pointing projections at a different store from events is allowed; making an operation atomic across two stores is not (that's spread storage, your concern).

::: tip One adapter per repository
Spreading a stream across stores is your plumbing behind the port — the library doesn't solve it, and doesn't prohibit it. Optimistic concurrency and in-place overwrite (for right-to-forget) are mandatory capabilities every adapter provides.
:::

## Errors the storage layer raises

| Error                                                                                              | When                                                                                         |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| [`StorageErrors.VERSION_CONFLICT`](/reference/error-index#persistence-storageerrors)               | `commit`/`append` lost an optimistic-concurrency race (expected-head mismatch).              |
| [`StorageErrors.OVERWRITE_UNKNOWN_POSITION`](/reference/error-index#persistence-storageerrors)     | `forget`/overwrite targeted a `(stream, position)` that isn't stored.                        |
| [`StorageErrors.APPEND_NOT_CONTIGUOUS`](/reference/error-index#persistence-storageerrors)          | Appended events aren't `expectedHead + 1…` — a caller sequencing bug, not a race.            |
| [`RepositoryErrors.PROJECTION_AHEAD_OF_HEAD`](/reference/error-index#persistence-repositoryerrors) | A stored projection's bookmark sits past a reachable head — refuses to heal over corruption. |

## ➡️ Next

- Wire one up: [🐘 Postgres](/guide/adapter-postgres) · [🍃 Mongo](/guide/adapter-mongo) · [🪣 S3](/guide/adapter-s3)
- [The repository & self-healing](/guide/repository) — the read/write path and the retry loop.
- [Observability](/guide/observability) — instrument every operation at the port boundary.
