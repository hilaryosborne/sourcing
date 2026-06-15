// An in-memory read-side double for PROVING cross-stream read models end to end without a real
// backend. It wraps the faithful `memoryStorage` StorageI double (so the REAL repository drives
// the write side, conflicts and all) and adds the two optional pieces a cross-stream view needs:
//   • StorageFeedI — a global feed whose order IS commit order: every appended event is logged
//     with the next cursor as the wrapped append succeeds (exactly the `instrument` wrap shape).
//   • ReadModelStoreI — an in-memory checkpoint + state store keyed by read-model name.
// Not shipped; a __tests__ helper. The real Postgres/Mongo feed implementations are backfill
// (see docs/internal/design/cross-stream-read-models.md).
import type { StorageI } from "../storage/storage.interface";
import type { StorageFeedI, FeedEntry } from "../feed/feed";
import type { ReadModelStoreI } from "../read-model/read-model.store";
import type { StoredReadModelV1Type } from "../read-model/read-model.model";
import { memoryStorage } from "./memory-storage";

export const memoryReadSide = (): StorageI & StorageFeedI & ReadModelStoreI => {
  const inner = memoryStorage();
  const log: FeedEntry[] = [];
  let cursor = 0;
  const readModels = new Map<string, StoredReadModelV1Type>();

  return {
    ...inner,

    // Wrap append: enforce CAS/contiguity via the inner store first (it throws on conflict, and
    // nothing is logged in that case), then record each committed event in global commit order.
    append: async (stream, incoming, expectedHead) => {
      await inner.append(stream, incoming, expectedHead);
      for (const event of incoming) log.push({ cursor: ++cursor, event });
    },

    // The global feed: entries strictly after `after`, in commit order, bounded by `limit`.
    readFeed: async (after, limit) => {
      const start = after ?? 0;
      const entries = log.filter((entry) => entry.cursor > start).slice(0, limit);
      return { entries, cursor: entries.length ? entries[entries.length - 1]!.cursor : after };
    },

    // The read-model store.
    load: async (name) => readModels.get(name),
    save: async (stored) => {
      readModels.set(stored.name, stored);
    },
  };
};
