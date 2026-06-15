---
name: using-storage-adapters
description: >-
  How to WIRE the repository and a storage adapter from the published
  @hilaryosborne/sourcing-persistence + adapter packages — `repository({ storage })`, the
  repository surface (create/load/commit/rebuild/forget), configurable destinations, and the
  exact client-port wiring for Postgres, Mongo (replica set), and S3/MinIO. Use when a
  consumer is moving from core-only to stored, self-healing projections (Scenario 2), choosing
  a backend, wiring a real driver to an adapter, or implementing right-to-forget end to end.
  Assumes sourcing-concepts. Companions: using-aggregates, using-projections.
---

# Using storage adapters (the repository + a backend)

Core has no storage. The **repository** (`@hilaryosborne/sourcing-persistence`) adds the stored, self-healing read/write path, talking to a **storage adapter** through one interface (`StorageI`). You inject a **client port** — a thin adapter over your real driver — so the library never depends on a specific driver version.

## Compose the repository

```ts
import { repository } from "@hilaryosborne/sourcing-persistence";

const repo = repository({ storage }); // storage is a StorageI from one of the adapters below
```

`repository({ storage })` auto-wires the aggregate registry and projection store from that one adapter — you choose only the backend.

## The repository surface

```ts
const opening = await repo.create(Account); // fresh instance (core mints the id)
opening.events.add(AccountOpenedV1.create({ holder: "Ada" }).creator("user", "ada"));
await repo.commit(opening); // persist staged events, advance the head

const account = await repo.load(Account, opening.id); // hydrate history into `committed`
account.events.add(AccountDepositedV1.create({ amount: 100 }).creator("user", "ada"));
await repo.commit(account);

const balance = await repo.rebuild({ aggregate: Account, id: opening.id, projection: Balance });
await repo.forget({ aggregate: Account, id: opening.id, context: "gdpr" });
```

| Method                                                      | Does                                                                                        |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `create(definition)` → `Promise<instance>`                  | A fresh, empty aggregate instance. Nothing persisted until `commit`.                        |
| `load(definition, id)` → `Promise<instance>`                | Read the full stream and import it into `committed`, ready for more staging.                |
| `commit(instance)` → `Promise<instance>`                    | Append staged events under optimistic concurrency, advance the head, fold staged→committed. |
| `rebuild({ aggregate, id, projection })` → `Promise<State>` | The self-healing read (three outcomes below); heals the stored projection as a side effect. |
| `forget({ aggregate, id, context })` → `Promise<void>`      | Load → `strip(context)` → overwrite events in place → bin every projection for the stream.  |

**Self-healing `rebuild`** makes one cheap head read and picks the cheapest correct path: **no stored projection** → full build; **head > bookmark** (stale) → fold only the delta over the stored state; **head == bookmark** (current) → return as-is, no event fetch.

> **`forget` is idempotent and convergent — completion is an operational obligation.** It is not atomic across its steps; if it fails after overwrite but before binning projections, PII can persist in a cached "current" projection. **Re-run it until it succeeds.**

## Configurable destinations

Adapters take an optional `destinations` map telling each _kind_ where to live; an adapter reads each name as a table / collection / key-prefix:

```ts
{ events: "account_events", projections: "account_projections", registry?: "..." /* defaults to events */ }
```

The library targets **one destination per operation and never coordinates across destinations** — configurable, not coordinated. Pointing projections at a different store from events is allowed; making an operation atomic across two stores is not (that's spread storage, your concern).

## Wiring each adapter

Each adapter factory takes a **client port** you implement over your real driver. The ports are tiny. (These wirings are exactly what the library's own conformance suite runs against real Postgres, a Mongo replica set, and MinIO.)

### Postgres — `postgresStorage(pgClient, destinations?)` → `Promise<StorageI>`

The port is a single `query`:

```ts
import { Pool } from "pg";
import { postgresStorage, type PgClientPort } from "@hilaryosborne/sourcing-adapter-postgres";

const pool = new Pool({ host, port, user, password, database });
const pgClient: PgClientPort = {
  query: async (sql, params) => {
    const res = await pool.query(sql, params ? [...params] : undefined);
    return { rows: res.rows, rowCount: res.rowCount ?? 0 }; // surface the driver's SQLSTATE code unchanged
  },
};

const storage = await postgresStorage(pgClient, { events: "account_events", projections: "account_projections" });
```

The adapter creates its tables and the `(stream, position)` **unique index** at construction — that index _is_ the compare-and-append, so append maps a unique-violation (SQLSTATE `23505`) to `VERSION_CONFLICT`. Use a **Pool**, not a single Client, so concurrent appends race truthfully.

### Mongo — `mongoStorage(mongoClient, destinations?)` → `Promise<StorageI>`

**Operational precondition: a replica set** (even single-node) — multi-event append is wrapped in a transaction, and Mongo has no single-statement multi-document atomic write. The port exposes ops + `transaction` + `ensureUniqueIndex`:

```ts
import { MongoClient } from "mongodb";
import { mongoStorage, type MongoClientPort, type MongoOps } from "@hilaryosborne/sourcing-adapter-mongo";

const client = new MongoClient("mongodb://localhost:27017/?replicaSet=rs0");
const opsFor = (session?) => ({
  find: async (name, filter, options) => {
    /* cursor.sort/limit → toArray, pass { session } */
  },
  insertMany: async (name, docs) => {
    await client
      .db(DB)
      .collection(name)
      .insertMany([...docs], { session });
  },
  updateOne: async (name, filter, set) =>
    (await client.db(DB).collection(name).updateOne(filter, { $set: set }, { session })).matchedCount > 0,
  upsertOne: async (name, filter, doc) => {
    await client.db(DB).collection(name).replaceOne(filter, doc, { upsert: true, session });
  },
  deleteMany: async (name, filter) => {
    await client.db(DB).collection(name).deleteMany(filter, { session });
  },
});

const mongoClient: MongoClientPort = {
  ...opsFor(),
  transaction: async (work) => {
    const session = client.startSession();
    try {
      let r;
      await session.withTransaction(async () => {
        r = await work(opsFor(session));
      });
      return r;
    } finally {
      await session.endSession();
    }
  },
  ensureUniqueIndex: async (name, keys) => {
    await client.db(DB).collection(name).createIndex(keys, { unique: true });
  },
};

const storage = await mongoStorage(mongoClient, { events: "account_events", projections: "account_projections" });
```

A duplicate-key error (`11000`) inside the append transaction becomes `VERSION_CONFLICT`.

### S3 — `s3Storage(s3Client, { bucket }, destinations?)` → `StorageI` (synchronous)

The brutal one. Each aggregate is **one object** holding the whole stream; concurrency is etag-based compare-and-swap. The port:

```ts
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import { s3Storage, type S3ClientPort } from "@hilaryosborne/sourcing-adapter-s3";

const aws = new S3Client({
  /* endpoint, region, credentials; forcePathStyle: true for MinIO */
});
const s3Client: S3ClientPort = {
  get: async (bucket, key) => {
    /* GetObject → { body, etag }, or undefined on 404 */
  },
  putIfAbsent: async (bucket, key, body) => {
    /* PutObject IfNoneMatch:"*"; true, or false on 412 */
  },
  putIfMatch: async (bucket, key, body, etag) => {
    /* PutObject IfMatch:etag; true, or false on 412 */
  },
  put: async (bucket, key, body) => {
    /* unconditional PutObject (projections only) */
  },
  list: async (bucket, prefix) => {
    /* ListObjectsV2 → keys[] */
  },
  delete: async (bucket, keys) => {
    /* DeleteObjects (no-op on empty) */
  },
};

const storage = s3Storage(s3Client, { bucket: "my-events" }, { events: "aggregates", projections: "projections" });
```

Know the S3 trade-offs (structural, by design): **unbounded object growth** (every commit rewrites the whole stream object); **append must read the full object first** (etag-CAS needs the current etag — load-bearing, not removable); **a stale delta read costs a full read** (no sub-object reads, so STALE saves nothing on S3); **concurrent forgets converge** via etag-CAS (the loser retries). If the interface works on S3, it works anywhere — that's why S3 is in the reference set.

## Errors the storage layer raises

| Error                                       | When                                                                                         |
| ------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `StorageErrors.VERSION_CONFLICT`            | `commit`/`append` lost an optimistic-concurrency race (expectedHead mismatch).               |
| `StorageErrors.OVERWRITE_UNKNOWN_POSITION`  | `forget`/overwrite targeted a `(stream, position)` that isn't stored.                        |
| `StorageErrors.APPEND_NOT_CONTIGUOUS`       | Appended events aren't `expectedHead + 1…` — a caller sequencing bug, not a race.            |
| `RepositoryErrors.PROJECTION_AHEAD_OF_HEAD` | A stored projection's bookmark sits past a reachable head — refuses to heal over corruption. |

## Gotchas

- **Catch `VERSION_CONFLICT` and retry** the load→stage→commit cycle — it's the normal signal that someone committed first.
- **Mongo without a replica set will fail** on the append transaction. A single-node replica set is enough for local/dev.
- **Don't expect cheap deltas on S3.** Pick Postgres/Mongo if stale-delta read cost matters.
- **One adapter per repository.** Spreading a stream across stores is your plumbing behind the port — the library does not solve it, and does not prohibit it.
