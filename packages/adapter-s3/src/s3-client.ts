// DRAFT — Epic 4, Phase C (S3 adapter, single-file layout). The minimal S3 surface the
// adapter needs, as an INJECTED port — so the adapter's logic (single-file layout, etag-CAS,
// overwrite-by-position) is testable against an in-memory fake and the concrete AWS/MinIO
// client is a Phase D wiring detail (interface-adapters §"constructor DI"). Awaiting
// per-artefact ratification (DRAFT-AND-HALT.md).
//
// Every method maps to exactly ONE native S3 operation / precondition — nothing that needs a
// feature S3 lacks. `bucket` is an explicit parameter: the port stays bucket-AGNOSTIC, and
// the adapter (constructed against one bucket — store identity) passes it on every call. The
// destination PREFIX lives inside the key; the bucket is the store, not the destination.
//
// ── KEY BRANDING (enforcement, not convention) ────────────────────────────────────────────
// The unconditional `put` must be reachable for PROJECTION objects only — never the event
// object, or it is a hole in the CAS. Enforced at the TYPE LEVEL: the conditional CAS ops
// take an `AggregateKey`, the unconditional `put` takes a `ProjectionKey`, and the two brands
// are mutually unassignable. A `put(bucket, aggregateKey(...))` is then a compile error.
export type AggregateKey = string & { readonly __kind: "aggregate-key" };
export type ProjectionKey = string & { readonly __kind: "projection-key" };

export interface S3ClientPort {
  // GetObject — the object's body and its current ETag, or undefined if the key does not
  // exist (HTTP 404). The etag is the optimistic-concurrency token for the next conditional
  // write: read returns it, the matching write conditions on it.
  get(bucket: string, key: string): Promise<{ body: string; etag: string } | undefined>;

  // PutObject `If-None-Match: *` — a CREATE-ONLY put of the EVENT object. true if created,
  // false if the key already existed (HTTP 412). The one place stream creation is
  // first-write-wins.
  putIfAbsent(bucket: string, key: AggregateKey, body: string): Promise<boolean>;

  // PutObject `If-Match: <etag>` — overwrite the EVENT object ONLY if it still carries that
  // etag. true if written, false if the etag moved (HTTP 412) — a concurrent writer landed
  // first. This is the append/overwrite compare-and-swap.
  putIfMatch(bucket: string, key: AggregateKey, body: string, etag: string): Promise<boolean>;

  // PutObject (unconditional) — PROJECTION objects only: a mutable cache with no concurrency
  // contract (last-write-wins; a derived view that can always be rebuilt). The brand keeps
  // this off the event object.
  put(bucket: string, key: ProjectionKey, body: string): Promise<void>;

  // ListObjectsV2 — the full keys under a prefix.
  list(bucket: string, prefix: string): Promise<string[]>;

  // DeleteObjects — remove the given keys; a no-op for an empty list.
  delete(bucket: string, keys: string[]): Promise<void>;
}
