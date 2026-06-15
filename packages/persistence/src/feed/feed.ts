// THE FEED — an OPTIONAL, ADVERTISED storage capability: read every event across ALL streams in
// a stable, resumable global order. This is what cross-stream read models fold over.
//
// It is deliberately NOT part of StorageI. FOUNDATION keeps global/cross-stream ordering off the
// shared port (S3 can't provide it without an external sequencer; it would break the S3-honesty
// the port is built on). So a backend that CAN offer a cheap global order (a single Postgres
// sequence, a Mongo change stream) implements this capability; one that can't simply doesn't, and
// cross-stream read models aren't available on it. This mirrors the existing ruling exactly and
// does not reopen it. (Design: docs/internal/design/cross-stream-read-models.md.)
import type { EventEnvelopeV1Type } from "@hilaryosborne/sourcing";

// An opaque, monotonically increasing global position. v1 models it as an integer; an adapter is
// free to back it with a sequence value, a (timestamp, tiebreak), or an oplog resume token. The
// processor only stores and replays it through the read-model checkpoint — it never interprets it.
export type FeedCursor = number;

// One event in the global feed: the event envelope (with its own stream ref + stream-local
// position) tagged with its global cursor. The cursor is the feed's address; the envelope's
// `aggregate` tells a read model which stream it came from.
export interface FeedEntry {
  cursor: FeedCursor;
  event: EventEnvelopeV1Type;
}

// A page of the feed: the entries after the requested cursor (up to the limit), and the cursor to
// resume from next time (the last entry's cursor, or the input cursor unchanged when the page is
// empty). A page shorter than the limit means the feed is drained.
export interface FeedPage {
  entries: FeedEntry[];
  cursor: FeedCursor | undefined;
}

export interface StorageFeedI {
  // Read events across all streams in global commit order, strictly AFTER `after` (undefined =
  // from the very beginning), at most `limit` of them. Resumable: pass back the returned cursor.
  //
  // ⚠ Adapter authors: "global order" has a real concurrency hazard — a sequence value can be
  // assigned before its row is visible, so a naive `id > cursor` scan can skip events committed
  // out of order. A correct feed must respect a visibility / low-water-mark check. Recorded so it
  // is designed, not discovered under load (see the design doc, "Open questions").
  readFeed(after: FeedCursor | undefined, limit: number): Promise<FeedPage>;
}
