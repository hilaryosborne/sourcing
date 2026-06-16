# 🍃 Mongo adapter

`@hilaryosborne/sourcing-adapter-mongo` persists events and projections to MongoDB. Choose it when Mongo is already your store — but mind the one hard requirement: **it needs a replica set.**

## When to choose it

- Mongo is your operational datastore and you'd rather not add Postgres.
- You're comfortable running a replica set (even a single-node one).
- Document-shaped storage and Mongo's tooling fit your team.

Like Postgres, Mongo gives **cheap delta reads** (a stale `rebuild` fetches only the new events).

## Install

```sh
npm install @hilaryosborne/sourcing-persistence @hilaryosborne/sourcing-adapter-mongo mongodb
```

::: warning Mongo requires a replica set
Multi-event appends run inside a **transaction**, and Mongo has no single-statement multi-document atomic write. A standalone `mongod` will fail at commit. A single-node replica set is enough for local/dev — start it with `--replSet rs0`, initiate it once with `rs.initiate()`, and connect with `directConnection=true` so the driver talks to that node directly. ([local setup →](/guide/installation#local-databases-for-development))
:::

## Wire the client port

The port exposes the document ops the adapter needs, plus `transaction` (for atomic multi-event appends) and `ensureUniqueIndex` (the compare-and-append):

```ts
import { MongoClient } from "mongodb";
import { mongoStorage, type MongoClientPort } from "@hilaryosborne/sourcing-adapter-mongo";
import { repository } from "@hilaryosborne/sourcing-persistence";

const client = new MongoClient("mongodb://localhost:27017/?replicaSet=rs0&directConnection=true");
const DB = "sourcing";

const opsFor = (session?) => ({
  find: async (name, filter, options) => {
    let cursor = client.db(DB).collection(name).find(filter, { session });
    if (options?.sort) cursor = cursor.sort(options.sort);
    if (options?.limit) cursor = cursor.limit(options.limit);
    return cursor.toArray();
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
      let result;
      await session.withTransaction(async () => {
        result = await work(opsFor(session));
      });
      return result;
    } finally {
      await session.endSession();
    }
  },
  ensureUniqueIndex: async (name, keys) => {
    await client.db(DB).collection(name).createIndex(keys, { unique: true });
  },
};

const storage = await mongoStorage(mongoClient, { events: "account_events", projections: "account_projections" });
const repo = repository({ storage });
```

## What it creates

`mongoStorage` is **async** because it ensures the unique index on `(stream_name, stream_id, position)` at construction — idempotently, and as a precondition, not an optimisation. Without it, `insertMany` would succeed on a duplicate position and silently void compare-and-append. A duplicate-key error (`11000`) inside the append transaction becomes [`VERSION_CONFLICT`](/reference/error-index#persistence-storageerrors).

Collection names come from the `destinations` map (defaults: `sourcing_events`, `sourcing_projections`), validated against `^[A-Za-z_][A-Za-z0-9_.-]*$` (no `$` prefix, not `system.*`).

## Constraints & trade-offs

- **Replica set is mandatory** — the transaction floor for atomic multi-event appends.
- **Cheap deltas** — a stale `rebuild` reads only events after the bookmark.
- **Atomicity comes from the transaction** — what Postgres gets from a single statement, Mongo gets from `withTransaction`.

## ➡️ Next

- [The repository & self-healing](/guide/repository) — the read/write path over this adapter.
- [Storage adapters: overview](/guide/storage-adapters) — compare the three.
- [Installation & setup](/guide/installation#local-databases-for-development) — a local Mongo replica set.
