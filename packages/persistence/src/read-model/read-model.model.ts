// The persisted form of a cross-stream read model: its state plus a CHECKPOINT (the feed cursor
// it has consumed up to). The checkpoint is what makes the processor resumable — catch-up reads
// the feed strictly after this cursor, so a restart never re-folds from the beginning.
import { object, string, number, unknown } from "zod";
import type { z } from "zod";

export const StoredReadModelV1 = object({
  // The read model's own name (ReadModelDefinition.name) — the store key.
  name: string().min(1),

  // The feed cursor this model has folded up to. v1 models the cursor as a monotonic integer;
  // it is OPAQUE in spirit (an adapter may back it with a sequence number, an oplog token, …),
  // and the processor only stores and replays it — never interprets it.
  cursor: number().int().min(0),

  // The read-model state. `unknown` ON PURPOSE — persistence does not know the shape; the
  // consumer's ReadModelDefinition owns and validates it on every fold.
  state: unknown(),
});
export type StoredReadModelV1Type = z.infer<typeof StoredReadModelV1>;
