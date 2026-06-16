# 🗂️ Data model reference

Everything the library stores is a small, explicit, Zod-validated shape. There's no hidden envelope, no ORM metadata, no framework columns — what you see here is what lands in your Postgres row, your Mongo document, or your S3 object. This page is the canonical reference for those shapes.

Two principles run through all of them:

- **The library validates structure, never meaning.** It checks that an `id` is a non-empty string and a `position` is a non-negative integer. It never interprets a `topic`, a `version` ordinal, or a `payload` — those are opaque to it. ([Mechanism, not judgment →](/guide/what-is-sourcing#mechanism-not-judgment))
- **`payload` and `state` are `unknown` to the envelope.** A stored event's `payload` is validated by _your_ event definition's schema, not by the envelope; a projection's `state` is validated by _your_ projection schema. The storage shapes below deliberately type them as `unknown`.

All of these are exported, so you can build, validate, or persist against them directly.

---

## `EventEnvelopeV1` — the persisted event

The complete, on-disk shape of a single event. Exported from `@hilaryosborne/sourcing` as both the schema (`EventEnvelopeV1`) and its inferred type (`EventEnvelopeV1Type`).

```ts
import { object, string, number, record, unknown } from "zod";

export const EventEnvelopeV1 = object({
  id: string().min(1), // intrinsic identity (nanoid)
  topic: string().min(1), // opaque, unique-within-aggregate
  version: number().int().min(1).default(1), // 1-based version ordinal — opaque to the library
  position: number().int().min(0), // 0-based index within this stream
  aggregate: AggregateRefV1, // { id, name }
  creator: CreatorSchemaV1, // { entity, uid } — required provenance
  headers: record(string(), unknown()).default({}), // optional caller decoration
  created: string().min(1), // ISO-8601, stamped once at creation
  payload: unknown(), // validated by the event definition, not here
});
```

| Field       | Type                                                     | Notes                                                                                                                                                                          |
| ----------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`        | `string` (≥1)                                            | Minted with `nanoid` at `create()`. Stable for the life of the event, including through stripping.                                                                             |
| `topic`     | `string` (≥1)                                            | The event's name, e.g. `account.opened`. Opaque and unique within one aggregate.                                                                                               |
| `version`   | `int` (≥1, default `1`)                                  | The **version ordinal** the event was written at. The library counts from it to apply the upcast chain to head; it never parses its _meaning_. ([Versioning →](/guide/events)) |
| `position`  | `int` (≥0)                                               | The event's index in its stream. Assigned (provisionally) at staging.                                                                                                          |
| `aggregate` | [`AggregateRefV1`](#aggregaterefv1-the-stream-reference) | Which stream this event belongs to. Assigned at staging.                                                                                                                       |
| `creator`   | [`CreatorSchemaV1`](#creatorschemav1-provenance)         | Who/what caused it. Required — no default.                                                                                                                                     |
| `headers`   | `Record<string, unknown>` (default `{}`)                 | Optional, opaque pass-through metadata.                                                                                                                                        |
| `created`   | `string` (≥1)                                            | ISO-8601 timestamp, captured once at creation and never changed.                                                                                                               |
| `payload`   | `unknown`                                                | The event body. Validated by your event definition's version schema.                                                                                                           |

### Field lifecycle

A freshly-created event is **not** yet a complete envelope — some fields are filled only when it's staged onto an aggregate. This is why a just-`create()`d event can't be built into an envelope until it has been added to an aggregate.

| Stage                                                         | Fields established                             |
| ------------------------------------------------------------- | ---------------------------------------------- |
| `event.create(payload)`                                       | `id`, `topic`, `version`, `created`, `payload` |
| `.creator(entity, uid)` / `.headers(…)` (fluent, pre-staging) | `creator`, `headers`                           |
| `aggregate.events.add(event)` (staging)                       | `position`, `aggregate`                        |

::: warning Provisional positions collide by design
`position` is assigned when an event is _staged_, as the next index in the aggregate you can see. Two processes staging onto separately-loaded copies of the same stream will both pick the same next index — and that's fine. Reconciling the collision is the repository's optimistic-concurrency job at commit, not core's. ([VERSION_CONFLICT →](/reference/error-index#persistence-storageerrors))
:::

---

## `CreatorSchemaV1` — provenance

Who or what caused an event. Required on every event; the library never interprets it.

```ts
export const CreatorSchemaV1 = object({
  entity: string().min(1), // the kind of actor, e.g. "user", "system", "job"
  uid: string().min(1), // its identity within that kind, e.g. a user id
});
```

| Field    | Type          | Notes                                                           |
| -------- | ------------- | --------------------------------------------------------------- |
| `entity` | `string` (≥1) | The actor's _kind_ — your convention (`"user"`, `"system"`, …). |
| `uid`    | `string` (≥1) | The actor's identity within that kind.                          |

Set it with the fluent setter: `event.create(payload).creator("user", "ada")`. There's deliberately no default — a permanent, immutable fact with bogus provenance is worse than one that refuses to be created.

---

## `AggregateRefV1` — the stream reference

Identifies one stream. Used as the `aggregate` field on every event, and as the `StorageStream` key adapters address. (Exported from persistence as `StorageStream`, an alias of this type.)

```ts
export const AggregateRefV1 = object({
  id: string().min(1), // the aggregate instance's id
  name: string().min(1), // the aggregate definition's name
});
```

| Field  | Type          | Notes                                                 |
| ------ | ------------- | ----------------------------------------------------- |
| `id`   | `string` (≥1) | The instance id (minted by core, or supplied by you). |
| `name` | `string` (≥1) | The aggregate definition's name, e.g. `account`.      |

The `(name, id)` pair is how every adapter locates a stream — a Postgres `(stream_name, stream_id)`, a Mongo filter, an S3 key prefix.

---

## `StoredProjectionV1` — a cached projection

The persistence layer's cache of a built projection: the read-model `state` plus the `position` bookmark it was folded up to. Exported from `@hilaryosborne/sourcing-persistence`.

```ts
export const StoredProjectionV1 = object({
  aggregate: AggregateRefV1, // which stream this projection is of
  name: string().min(1), // the projection definition's name (its store key)
  position: number().int().min(0), // bookmark: the last event position folded into state
  state: unknown(), // the read model, validated by your projection schema
});
```

| Field       | Type                                                     | Notes                                                                                                                                                                                                                                           |
| ----------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `aggregate` | [`AggregateRefV1`](#aggregaterefv1-the-stream-reference) | The stream the projection is built from.                                                                                                                                                                                                        |
| `name`      | `string` (≥1)                                            | The projection's identity in the store. Make it stable and unique.                                                                                                                                                                              |
| `position`  | `int` (≥0)                                               | The **bookmark** — the head position at the time of the last fold. Comparing it to the live stream head is how self-healing decides _current_ vs _stale_. ([self-healing →](/guide/use-cases#persist-projections-that-keep-themselves-current)) |
| `state`     | `unknown`                                                | Your read model. Validated by your projection's schema, not by this envelope.                                                                                                                                                                   |

The bookmark travels _with_ the state in one record, never separately — so the cheap "is it current?" path can never read a state and a bookmark that disagree.

---

## `StoredReadModelV1` — a cross-stream read model

The stored state of a [cross-stream read model](/reference/api-persistence#cross-stream-read-models): state plus a feed `cursor` rather than a per-stream bookmark. Exported from `@hilaryosborne/sourcing-persistence`.

```ts
export const StoredReadModelV1 = object({
  name: string().min(1), // the read-model definition's name (store key)
  cursor: number().int().min(0), // how far through the global feed it has folded
  state: unknown(), // the read model, validated by your schema
});
```

| Field    | Type          | Notes                                                                             |
| -------- | ------------- | --------------------------------------------------------------------------------- |
| `name`   | `string` (≥1) | The read model's identity in the store.                                           |
| `cursor` | `int` (≥0)    | Position in the **global feed** (across all streams), not a single stream's head. |
| `state`  | `unknown`     | Your read model, validated by your schema.                                        |

As with projections, the `cursor` travels with the `state` so a restart never reads state that's ahead of or behind its checkpoint.

---

## `FeedEntry` / `FeedPage` — the global feed

The shape the optional [global feed](/reference/api-persistence#feed) yields when a cross-stream read model catches up. Available only on adapters that can offer global ordering.

```ts
export type FeedCursor = number; // opaque, monotonically increasing

export interface FeedEntry {
  cursor: FeedCursor; // resume token for the entry after this one
  event: EventEnvelopeV1Type; // the event, in global commit order
}

export interface FeedPage {
  entries: FeedEntry[];
  cursor: FeedCursor | undefined; // pass back to continue; undefined when drained
}
```

::: info The feed reflects erasure
The feed reads the _current_ stored events, so an event that has been redacted by [right-to-forget](/guide/right-to-forget) appears in its stripped form — the feed can't leak PII that's already been erased from the stream.
:::

## ➡️ Next

- [Error index](/reference/error-index) — what's raised when these shapes don't validate.
- [API: core](/reference/api-core) — the builders that produce these shapes.
- [API: persistence](/reference/api-persistence) — the repository and storage port that persist them.
