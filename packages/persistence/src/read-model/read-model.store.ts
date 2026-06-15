// The read-model store — load/save a cross-stream read model's state + checkpoint, keyed by its
// name. The counterpart of the projection store, for cross-stream views. Like every other seam
// here it is a small interface an adapter (or a consumer) implements; the processor depends only
// on this, never on a concrete backend.
import type { StoredReadModelV1Type } from "./read-model.model";

export interface ReadModelStoreI {
  // Fetch the stored read model for `name`, or undefined if it has never been built. Undefined
  // drives "fold from the beginning of the feed" on first catch-up.
  load(name: string): Promise<StoredReadModelV1Type | undefined>;

  // Upsert a read model's state + checkpoint by name. State and cursor travel together: they are
  // saved as one record so a restart never reads a state ahead of (or behind) its checkpoint.
  save(stored: StoredReadModelV1Type): Promise<void>;
}
