// THE PROCESSOR — a resumable catch-up subscription that keeps a cross-stream read model current.
// It is the thin wire between the three honest pieces: a pure `readModel` fold, an optional
// `StorageFeedI` (the global ordered feed), and a `ReadModelStoreI` (the checkpoint + state).
//
// Two operations:
//   • catchUp() — the steady state. Load the checkpoint + state, pull the feed strictly after that
//     cursor in batches, fold each batch, save state + cursor. RESUMABLE (durable checkpoint, never
//     replays from 0), IDEMPOTENT when nothing new has arrived, and AT-LEAST-ONCE (a crash between
//     fold and save replays the last batch — so handlers must be idempotent; documented obligation).
//   • rebuild() — the recovery path. RE-FOLD THE WHOLE FEED from zero, over the seed. The feed
//     reflects in-place redactions (StorageFeedI is GDPR-critical), so this is how you purge PII a
//     cross-stream read model derived BEFORE a right-to-forget: forget the stream, then rebuild the
//     read model. catchUp alone cannot heal it — it only folds NEW events, never re-reads the
//     redacted history. Cross-stream read models are not stream-bound, so the repository's forget
//     cannot bin them; rebuilding affected read models is the consumer's completion obligation,
//     exactly like forget's own "re-run until done".
//
// (Design + open questions — exactly-once, the cost of a full rebuild, real-adapter feeds:
// docs/internal/design/cross-stream-read-models.md.)
import type { ReadModelDefinition } from "../read-model/read-model";
import type { ReadModelStoreI } from "../read-model/read-model.store";
import type { StorageFeedI, FeedCursor } from "../feed/feed";

export interface ProcessorDeps {
  // The global event feed (an adapter capability). If your backend can't provide one, cross-stream
  // read models aren't available on it.
  feed: StorageFeedI;
  // Where each read model's state + checkpoint lives.
  store: ReadModelStoreI;
}

export interface CatchUpOptions {
  // How many feed entries to pull and fold per batch. Default 500. Smaller = more frequent saves
  // (cheaper replay on crash); larger = fewer round-trips.
  batchSize?: number;
}

export interface ProcessorI {
  // Bring `model` up to date with the feed and return its current state. Pulls and folds in
  // batches from the stored checkpoint until the feed is drained, saving after each batch.
  catchUp<State>(model: ReadModelDefinition<State>, options?: CatchUpOptions): Promise<State>;

  // Re-fold `model` from the very start of the (now possibly redacted) feed, discarding its prior
  // state and checkpoint, and return the rebuilt state. The post-forget PII-purge path.
  rebuild<State>(model: ReadModelDefinition<State>, options?: CatchUpOptions): Promise<State>;
}

const DEFAULT_BATCH = 500;

export const processor = (deps: ProcessorDeps): ProcessorI => {
  const { feed, store } = deps;

  // Shared pump: fold the feed forward from (cursor, state) to the end, saving after each batch so
  // progress is never lost. Returns the final cursor + state.
  const pump = async <State>(
    model: ReadModelDefinition<State>,
    cursor: FeedCursor | undefined,
    state: State,
    batchSize: number,
  ): Promise<{ cursor: FeedCursor | undefined; state: State }> => {
    for (;;) {
      const page = await feed.readFeed(cursor, batchSize);
      if (page.entries.length === 0) break; // fully caught up
      state = model.fold(
        page.entries.map((entry) => entry.event),
        state,
      );
      cursor = page.cursor;
      await store.save({ name: model.name, cursor: cursor ?? 0, state });
      if (page.entries.length < batchSize) break; // last (partial) page — drained
    }
    return { cursor, state };
  };

  return {
    catchUp: async (model, options) => {
      const stored = await store.load(model.name);
      // Resume from the stored checkpoint, or start from the beginning with the model's seed.
      const cursor = stored?.cursor;
      const state = stored ? model.schema.parse(stored.state) : model.initial;
      return (await pump(model, cursor, state, options?.batchSize ?? DEFAULT_BATCH)).state;
    },

    rebuild: async (model, options) => {
      // Discard the checkpoint: re-fold the WHOLE feed (reflecting any redactions) over the seed.
      const result = await pump(model, undefined, model.initial, options?.batchSize ?? DEFAULT_BATCH);
      // Persist the reset even if the feed was empty, so the checkpoint returns to a clean slate.
      await store.save({ name: model.name, cursor: result.cursor ?? 0, state: result.state });
      return result.state;
    },
  };
};

export default processor;
