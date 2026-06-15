// An in-memory read-side double for PROVING cross-stream read models end to end without a real
// backend. It wraps the faithful `memoryStorage` StorageI double (so the REAL repository drives
// the write side, conflicts and all) and adds the two optional pieces a cross-stream view needs:
//   • StorageFeedI — a global feed. CRUCIALLY, it is an ORDER INDEX over canonical events
//     (addresses, not copies): readFeed re-reads the CURRENT event at each (stream, position), so
//     an in-place overwrite (right-to-forget) propagates to the feed and a rebuilt read model
//     never re-folds the original PII. This mirrors the GDPR-critical requirement on StorageFeedI
//     — a real feed is a resumable QUERY over current event state, never an append-only copy.
//   • ReadModelStoreI — an in-memory checkpoint + state store keyed by read-model name.
// Not shipped; a __tests__ helper. Real Postgres/Mongo feeds are backfill (see the design doc).
import type { StorageI } from "../storage/storage.interface";
import type { StorageFeedI, FeedEntry } from "../feed/feed";
import type { ReadModelStoreI } from "../read-model/read-model.store";
import type { StoredReadModelV1Type } from "../read-model/read-model.model";
import type { StorageStream } from "../storage/storage.model";
import { memoryStorage } from "./memory-storage";

export const memoryReadSide = (): StorageI & StorageFeedI & ReadModelStoreI => {
  const inner = memoryStorage();
  // The feed is an index of ADDRESSES in global commit order — never copies of payloads.
  const order: { cursor: number; stream: StorageStream; position: number }[] = [];
  let cursor = 0;
  const readModels = new Map<string, StoredReadModelV1Type>();

  return {
    ...inner,

    // Wrap append: enforce CAS/contiguity via the inner store first (it throws on conflict, and
    // nothing is indexed in that case), then record each committed event's ADDRESS in global order.
    append: async (stream, incoming, expectedHead) => {
      await inner.append(stream, incoming, expectedHead);
      for (const event of incoming) order.push({ cursor: ++cursor, stream, position: event.position });
    },

    // The global feed: addresses after `after`, in commit order, bounded by `limit` — re-reading
    // the CURRENT event at each address (so a later overwrite shows through).
    readFeed: async (after, limit) => {
      const start = after ?? 0;
      const slice = order.filter((entry) => entry.cursor > start).slice(0, limit);
      const entries: FeedEntry[] = [];
      for (const address of slice) {
        const events = await inner.read(address.stream); // current payloads (redacted if overwritten)
        const event = events.find((stored) => stored.position === address.position);
        if (event) entries.push({ cursor: address.cursor, event });
      }
      return { entries, cursor: slice.length ? slice[slice.length - 1]!.cursor : after };
    },

    // The read-model store.
    load: async (name) => readModels.get(name),
    save: async (stored) => {
      readModels.set(stored.name, stored);
    },
  };
};
