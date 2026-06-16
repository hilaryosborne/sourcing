# 🪣 S3 adapter

`@hilaryosborne/sourcing-adapter-s3` persists to S3 (or any S3-compatible store — MinIO, R2, etc.). It's the **brutal one**: a store with almost no features, which is exactly why it's in the reference set. _If the interface works on S3, it works anywhere._

## When to choose it

- You want cheap, durable object storage and your streams aren't write-hot.
- You're fine trading delta-read efficiency for operational simplicity (no database to run).
- You understand and accept the structural costs below — they're by design, not bugs.

## Install

```sh
npm install @hilaryosborne/sourcing-persistence @hilaryosborne/sourcing-adapter-s3 @aws-sdk/client-s3
```

## Wire the client port

Concurrency is **etag-based compare-and-swap**. The port's keys are type-branded so a conditional aggregate write can never be confused with an unconditional projection write — `put(bucket, aggregateKey(...))` is a _compile_ error:

```ts
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import { s3Storage, type S3ClientPort } from "@hilaryosborne/sourcing-adapter-s3";
import { repository } from "@hilaryosborne/sourcing-persistence";

const aws = new S3Client({
  /* endpoint, region, credentials; forcePathStyle: true for MinIO */
});

const s3Client: S3ClientPort = {
  get: async (bucket, key) => {
    /* GetObject → { body, etag }, or undefined on 404 */
  },
  putIfAbsent: async (bucket, key, body) => {
    /* PutObject IfNoneMatch:"*" → true, or false on 412 (key already exists) */
  },
  putIfMatch: async (bucket, key, body, etag) => {
    /* PutObject IfMatch:etag → true, or false on 412 (etag moved) */
  },
  put: async (bucket, key, body) => {
    /* unconditional PutObject — projections only */
  },
  list: async (bucket, prefix) => {
    /* ListObjectsV2 → keys[] */
  },
  delete: async (bucket, keys) => {
    /* DeleteObjects (no-op on empty) */
  },
};

const storage = s3Storage(s3Client, { bucket: "my-events" }, { events: "aggregates", projections: "projections" });
const repo = repository({ storage });
```

`s3Storage` is **synchronous** — the store identity (the bucket) is fixed at construction, and there are no indexes to create.

## The layout

One object holds an aggregate's **entire** event stream, so a reader GETs it in a single shot — there's no window where a list races an in-flight commit and sees a half-written stream:

```
aggregates/{stream.name}/{stream.id}.json        → { events: [ …envelopes… ] }
projections/{stream.name}/{stream.id}/{name}.json → { state, position }
```

Append is a read-modify-write under an etag precondition: read the object, check the head, write back with `If-Match`. Two guards both surface as [`VERSION_CONFLICT`](/reference/error-index#persistence-storageerrors) — a stale expected-head (load→commit gap) and a moved etag (re-read→write race). Stream creation uses `If-None-Match: *` (first-write-wins). Prefix names come from `destinations` (defaults: `aggregates`, `projections`), validated as safe, single-slash-separated path segments.

## Constraints & trade-offs (structural, by design)

- **Unbounded object growth.** Every commit rewrites the whole stream object, so read and write cost grow with stream length, without bound. This is the price of atomic single-object reads; bounding it (snapshotting) would reintroduce a read seam and is deliberately out of scope.
- **Append must read the full object first.** etag-CAS needs the current etag — load-bearing, not removable.
- **No cheap delta.** There are no sub-object reads on S3, so a _stale_ `rebuild` reads the **whole** object — the same cost as a full build. **STALE saves nothing on S3, by design.** Relational/document adapters don't have this; if delta cost matters, pick [Postgres](/guide/adapter-postgres) or [Mongo](/guide/adapter-mongo).
- **Concurrent forgets converge** via etag-CAS — the loser retries.

## ➡️ Next

- [The repository & self-healing](/guide/repository) — the read/write path over this adapter.
- [Storage adapters: overview](/guide/storage-adapters) — the decision matrix.
- [Why event sourcing?](/guide/what-is-sourcing#okay-whats-the-catch) — the honest take on S3's costs.
