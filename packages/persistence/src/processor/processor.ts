// THE PROCESSOR — a resumable catch-up subscription that keeps a cross-stream read model current.
// It is the thin wire between the three honest pieces: a pure `readModel` fold, an optional
// `StorageFeedI` (the global ordered feed), and a `ReadModelStoreI` (the checkpoint + state).
//
// catchUp() is the whole story: load the read model's checkpoint + state, pull the feed strictly
// after that cursor in batches, fold each batch through the model, and save state + cursor. It is
//   • RESUMABLE — the cursor is a durable checkpoint, so a restart continues, never replays from 0;
//   • IDEMPOTENT under no-new-events — re-running when the feed hasn't advanced folds nothing and
//     re-saves the same state;
//   • AT-LEAST-ONCE — a crash between fold and save replays the last batch on the next run, so
//     handlers must be idempotent (set-by-key, not blind-increment). This is a documented consumer
//     obligation, not magicked away (see the design doc).
//
// (Design + open questions — GDPR interaction, exactly-once, feed visibility: docs/internal/design/cross-stream-read-models.md.)
import type { ReadModelDefinition } from "../read-model/read-model";
import type { ReadModelStoreI } from "../read-model/read-model.store";
import type { StorageFeedI } from "../feed/feed";

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
  // batches until the feed is drained, saving state + checkpoint after each batch so progress is
  // never lost. Returns the validated read-model state.
  catchUp<State>(model: ReadModelDefinition<State>, options?: CatchUpOptions): Promise<State>;
}

const DEFAULT_BATCH = 500;

export const processor = (deps: ProcessorDeps): ProcessorI => {
  const { feed, store } = deps;

  return {
    catchUp: async (model, options) => {
      const batchSize = options?.batchSize ?? DEFAULT_BATCH;

      // Resume from the stored checkpoint, or start from the beginning with the model's seed.
      const stored = await store.load(model.name);
      let cursor = stored?.cursor;
      // Lift the stored state out of `unknown` through the model's own schema; or seed it.
      let state = stored ? model.schema.parse(stored.state) : model.initial;

      // Pull → fold → save, batch by batch, until the feed is drained.
      for (;;) {
        const page = await feed.readFeed(cursor, batchSize);
        if (page.entries.length === 0) break; // nothing new — fully caught up

        state = model.fold(
          page.entries.map((entry) => entry.event),
          state,
        );
        cursor = page.cursor;
        await store.save({ name: model.name, cursor: cursor ?? 0, state });

        if (page.entries.length < batchSize) break; // last (partial) page — drained
      }

      return state;
    },
  };
};

export default processor;
