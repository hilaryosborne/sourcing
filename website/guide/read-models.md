# 🔭 Cross-stream read models

::: warning Advanced — you're past the ORM line
Everything else in this library folds **one** aggregate's stream. A cross-stream read model folds the **firehose** — every event across _all_ streams, in global order — into one denormalised view. That's the "data on the outside" shape the [ORM stance](/guide/what-is-sourcing#our-take-its-an-orm-not-an-architecture) deliberately avoids. It's an opt-in escape hatch, not the main path. If you don't need a view that spans aggregates, you don't need any of this.
:::

## What it's for

A projection answers questions about _one_ thing — this account's balance, this order's status. A cross-stream read model answers questions about _all_ of them at once: a dashboard of every order by status, a search index over every document, a customer's activity across all their carts. One denormalised view, folded from many streams.

## The one asymmetry: an explicit seed

A projection leans on its creating event (`*.opened`) to establish the model's shape — the [first-event contract](/guide/projections). A cross-stream read model has **no** creating event: it exists before any stream does (an empty list, an empty index). So its shape is seeded explicitly, with a required `initial`:

```ts
import { readModel } from "@hilaryosborne/sourcing-persistence";
import { record, string } from "zod";

// a live map of every order id → its latest status, across ALL order streams
export const OrdersBoard = readModel("orders-board", record(string(), string()), {} /* initial: empty */)
  .on<{ items: unknown[] }>(OrderPlaced, (board, e) => ({ ...board, [e.aggregate.id]: "placed" }))
  .on(OrderShipped, (board, e) => ({ ...board, [e.aggregate.id]: "shipped" }))
  .on(OrderCancelled, (board, e) => ({ ...board, [e.aggregate.id]: "cancelled" }));
```

The handler receives the typed event, and `e.aggregate.id` tells it _which_ stream the event came from — that's how a cross-stream view keys its rows. Unmapped topics are tolerated: the firehose carries everything; a read model folds only what it cares about.

## The pieces you wire

A read model is a pure fold. To keep it current you supply two seams and a processor:

| Piece                        | What it is                                | Who provides it                  |
| ---------------------------- | ----------------------------------------- | -------------------------------- |
| `readModel(...)`             | the pure cross-stream fold                | you define it (above)            |
| `StorageFeedI`               | the global, ordered, resumable event feed | **you implement it** (see below) |
| `ReadModelStoreI`            | where state + checkpoint live             | you implement it                 |
| `processor({ feed, store })` | the resumable catch-up wire               | the library                      |

::: danger No shipped adapter provides a feed yet
This is the honest state of play: the read-model _mechanism_ (the fold, the processor, the contracts) is shipped and public, but **none of the Postgres / Mongo / S3 adapters implement `StorageFeedI` today** — a global feed over those backends is on the roadmap (it needs a sequence/oplog cursor with a visibility guard). So right now you bring your own feed: trivial in-memory for tests, or a real one over your store. Global ordering is deliberately kept _off_ the shared `StorageI` port — S3 can't offer it without an external sequencer — so it's an advertised capability, never a promise.
:::

### The feed's one hard rule: it must reflect erasure

A `StorageFeedI` is a resumable **query over the current stored events**, not an append-only copy and not a change-stream tail. This is GDPR-critical: a [`forget`](/guide/right-to-forget) overwrites events in place, and a read model rebuilt from the feed afterwards **must** see the redacted version — or it folds the original PII straight back in. A change stream emits the immutable original and would never reflect the redaction; that's the trap. Read the payloads live; let the cursor only _order_ them.

## Keeping it current: the processor

```ts
import { processor } from "@hilaryosborne/sourcing-persistence";

const proc = processor({ feed, store }); // your feed + store
const board = await proc.catchUp(OrdersBoard); // fold new events from the checkpoint, return state
```

- **`catchUp`** is the steady state: load the checkpoint, pull the feed in batches (`batchSize` default 500), fold each, save state + cursor after every batch. **Resumable** (never replays from zero), **idempotent** when nothing new arrived, and **at-least-once** — a crash between fold and save replays the last batch, so **your handlers must be idempotent** (the map-assignment above is; a `count + 1` would not be).
- **`rebuild`** is the recovery path: discard the checkpoint and re-fold the whole feed over the seed. This is the **post-forget PII purge** — because a cross-stream read model isn't stream-bound, `repository.forget` _can't_ bin it for you. Forgetting a stream and then rebuilding the affected read models is your completion obligation, exactly like `forget`'s own "re-run until done."

## A complete, runnable example (in-memory)

For tests or a single-process app, an in-memory feed + store is enough. This one indexes event _addresses_ in commit order and re-reads current payloads, so redactions show through:

```ts
import type {
  StorageFeedI,
  FeedEntry,
  ReadModelStoreI,
  StoredReadModelV1Type,
} from "@hilaryosborne/sourcing-persistence";

// `inner` is any StorageI (e.g. memoryStorage()); we wrap its append to index commit order.
const order: { cursor: number; stream: { id: string; name: string }; position: number }[] = [];
let seq = 0;
const records = new Map<string, StoredReadModelV1Type>();

const feed: StorageFeedI = {
  readFeed: async (after, limit) => {
    const slice = order.filter((a) => a.cursor > (after ?? 0)).slice(0, limit);
    const entries: FeedEntry[] = [];
    for (const a of slice) {
      const events = await inner.read(a.stream); // CURRENT payloads (redacted if overwritten)
      const event = events.find((e) => e.position === a.position);
      if (event) entries.push({ cursor: a.cursor, event });
    }
    return { entries, cursor: slice.length ? slice[slice.length - 1]!.cursor : after };
  },
};

const store: ReadModelStoreI = {
  load: async (name) => records.get(name),
  save: async (stored) => void records.set(stored.name, stored),
};

// when you commit through the repository, record each event's address:
//   for (const e of committed) order.push({ cursor: ++seq, stream, position: e.position });

const board = await processor({ feed, store }).catchUp(OrdersBoard);
```

A real backend swaps the `order` array for a sequence/cursor query over your store — keeping the "read current payloads, order by cursor, respect visibility" contract.

## Errors

| Error                                                                                   | When                                                       |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| [`ReadModelErrors.OUTPUT_INVALID`](/reference/error-index#persistence-readmodelerrors)  | A fold produced state that fails the read model's schema.  |
| [`ReadModelErrors.TOPIC_DUPLICATE`](/reference/error-index#persistence-readmodelerrors) | Two `.on()` handlers for the same topic in one read model. |
| [`ReadModelErrors.MAPPER_INVALID`](/reference/error-index#persistence-readmodelerrors)  | A missing event definition or non-function handler.        |

## ➡️ Next

- [API: persistence](/reference/api-persistence#cross-stream-read-models) — exact signatures.
- [Right-to-forget](/guide/right-to-forget) — why `rebuild` is the purge path.
- [Projections](/guide/projections) — the single-stream counterpart.
