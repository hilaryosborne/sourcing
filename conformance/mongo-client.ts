// Concrete MongoClientPort over the real `mongodb` driver → the single-node replica set (Phase
// D wiring). directConnection=true: the set is initiated for transaction support, but the
// driver must talk to THIS node directly rather than rediscover a member host that isn't
// port-mapped out of the container. The two facts the adapter reads are surfaced unchanged: the
// duplicate-key error `code` (11000) and updateOne's matchedCount.
import { MongoClient } from "mongodb";
import type { ClientSession } from "mongodb";
import type { MongoClientPort, MongoFindOptions, MongoFilter, MongoOps } from "@hilaryosborne/sourcing-adapter-mongo";

const URI = "mongodb://127.0.0.1:27019/?directConnection=true";
const DB = "conformance";

const client = new MongoClient(URI);
let connected: Promise<void> | undefined;
const ready = (): Promise<void> => (connected ??= client.connect().then(() => undefined));

// One ops surface, optionally bound to a transaction session. Inside transaction() the same
// methods carry the session so every op enlists in the same commit/abort.
const opsFor = (session?: ClientSession): MongoOps => {
  const col = (name: string) => client.db(DB).collection(name);
  return {
    find: async <D = Record<string, unknown>>(name: string, filter: MongoFilter, options?: MongoFindOptions) => {
      let cursor = col(name).find(filter, { session });
      if (options?.sort) cursor = cursor.sort(options.sort);
      if (options?.limit !== undefined) cursor = cursor.limit(options.limit);
      return (await cursor.toArray()) as D[];
    },
    insertMany: async (name, docs) => {
      await col(name).insertMany([...docs], { session });
    },
    updateOne: async (name, filter, set) => {
      const res = await col(name).updateOne(filter, { $set: set }, { session });
      return res.matchedCount > 0;
    },
    upsertOne: async (name, filter, doc) => {
      await col(name).replaceOne(filter, doc, { upsert: true, session });
    },
    deleteMany: async (name, filter) => {
      await col(name).deleteMany(filter, { session });
    },
  };
};

export const mongoClient = (): MongoClientPort => ({
  ...opsFor(),
  transaction: async <T>(work: (tx: MongoOps) => Promise<T>): Promise<T> => {
    await ready();
    const session = client.startSession();
    try {
      let result: T;
      await session.withTransaction(async () => {
        result = await work(opsFor(session));
      });
      return result!;
    } finally {
      await session.endSession();
    }
  },
  ensureUniqueIndex: async (name, keys) => {
    await ready();
    await client.db(DB).collection(name).createIndex(keys, { unique: true });
  },
});

export const connectMongo = ready;
export const closeMongoClient = (): Promise<void> => client.close();
