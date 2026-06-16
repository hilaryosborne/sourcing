# 📗 API reference: persistence

Everything exported from `@hilaryosborne/sourcing-persistence` — the repository, the storage port adapters implement, the observer seam, the optional cross-stream read-model machinery, and the conformance suite. The core package has no dependency on any of this; you reach for it only when you want events _stored_.

```ts
import {
  repository,
  consoleObserver, // the repository + a batteries-included observer
  runConformance, // certify an adapter against the contract
  readModel,
  processor, // optional cross-stream read models
} from "@hilaryosborne/sourcing-persistence";
```

---

## `repository(deps)`

```ts
const repository: (deps: RepositoryDeps) => RepositoryI;

interface RepositoryDeps {
  storage: StorageI; // the adapter — Postgres / Mongo / S3 / your own
  observer?: Observer; // optional; silent by default
}
```

The repository is the write path, the self-healing read path, and the right-to-forget sequence, over whichever adapter you inject.

### `RepositoryI`

| Method                  | Signature                                                                     | Description                                                                                                                                                                                                |
| ----------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.create(definition)`   | `(definition: AggregateDefinition) => Promise<AggregateInstance>`             | A fresh, empty instance with a core-minted id. Nothing is stored yet.                                                                                                                                      |
| `.load(definition, id)` | `(definition: AggregateDefinition, id: string) => Promise<AggregateInstance>` | Hydrates an instance, importing the full stored stream into `committed`.                                                                                                                                   |
| `.commit(aggregate)`    | `(aggregate: AggregateInstance) => Promise<AggregateInstance>`                | Persists the staged events under an expected-head guard, folds staged → committed, and returns the instance. Throws [`VERSION_CONFLICT`](/reference/error-index#persistence-storageerrors) on a lost race. |
| `.rebuild(input)`       | `<State>(input: RebuildInput<State>) => Promise<State>`                       | The self-healing read (below). Returns up-to-date projected state, healing the stored projection as a side effect.                                                                                         |
| `.forget(input)`        | `(input: ForgetInput) => Promise<void>`                                       | Right-to-forget: redacts the stream's events in place and bins its projections. ([Right-to-forget →](/guide/right-to-forget))                                                                              |

```ts
interface RebuildInput<State> {
  aggregate: AggregateDefinition;
  id: string;
  projection: ProjectionDefinition<State>;
}
interface ForgetInput {
  aggregate: AggregateDefinition;
  id: string;
  context: string;
}
```

### Self-healing: how `rebuild` decides

One cheap head read picks the cheapest correct path by comparing the stored projection's **bookmark** to the stream **head**:

| Condition                      | Path                                                                   | Cost                   |
| ------------------------------ | ---------------------------------------------------------------------- | ---------------------- |
| no stored projection           | **full build** from the first event, then save                         | reads the whole stream |
| head > bookmark (**stale**)    | **delta fold** of only the new events over the stored state, then save | reads the delta        |
| head == bookmark (**current**) | return the stored state as-is                                          | no event fetch         |

If a stored projection's bookmark is _ahead_ of the head, `rebuild` refuses with [`PROJECTION_AHEAD_OF_HEAD`](/reference/error-index#persistence-repositoryerrors) rather than heal corruption silently.

---

## `StorageI` — the storage port

The seam every adapter implements, and the contract you implement to [write your own](/reference/api-persistence#conformance). It's two halves composed: `StorageI extends StorageEventsI, StorageProjectionsI`. The stream key is `StorageStream` (`= { id, name }`, an alias of [`AggregateRefV1`](/reference/data-models#aggregaterefv1-the-stream-reference)).

### `StorageEventsI`

| Method                                   | Signature                                                    | Semantics                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.head(stream)`                          | `(stream) => Promise<number \| undefined>`                   | Highest stored position, or `undefined` for an empty stream. The one cheap read self-healing relies on.                                                                                                                                                                                                              |
| `.read(stream, after?)`                  | `(stream, after?: number) => Promise<EventEnvelopeV1Type[]>` | Events in position order. `after` is **exclusive**; omit it to read from the start.                                                                                                                                                                                                                                  |
| `.append(stream, events, expectedHead?)` | `(stream, events, expectedHead?: number) => Promise<void>`   | Compare-and-append. If `expectedHead` doesn't match the stream's head → [`VERSION_CONFLICT`](/reference/error-index#persistence-storageerrors) (writes nothing). If the first position ≠ `expectedHead + 1` → [`APPEND_NOT_CONTIGUOUS`](/reference/error-index#persistence-storageerrors). **Mandatory capability.** |
| `.overwrite(stream, events)`             | `(stream, events) => Promise<void>`                          | The sanctioned immutability exception, for erasure only. Replaces payloads in place, matched by `(stream, position)`, all-or-nothing. Missing position → [`OVERWRITE_UNKNOWN_POSITION`](/reference/error-index#persistence-storageerrors).                                                                           |

### `StorageProjectionsI`

| Method                          | Signature                                                        | Semantics                                                                                                                                                  |
| ------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.loadProjection(stream, name)` | `(stream, name) => Promise<StoredProjectionV1Type \| undefined>` | The cached projection (state + bookmark), or `undefined` → drives a full build.                                                                            |
| `.saveProjection(stored)`       | `(stored: StoredProjectionV1Type) => Promise<void>`              | Upsert by `(aggregate, name)`.                                                                                                                             |
| `.deleteProjections(stream)`    | `(stream) => Promise<void>`                                      | Bin **every** projection for a stream. Essential to forget: `overwrite` doesn't move the head, so a "current" projection would otherwise mask the erasure. |

---

## The `Observer` seam

Optional, silent by default. Three independent channels; implement only the sink you wire. ([Observability guide →](/guide/observability))

```ts
interface Observer {
  logger?: Logger; // structured logs (Splunk-shaped)
  report?(report: ErrorReport): void | Promise<void>; // error tracking (New Relic-shaped)
  hook?(event: HookEvent): void | Promise<void>; // lifecycle profiling (metrics/OTel)
}

interface Logger {
  error;
  warn;
  info;
  debug: (event: string, data?: ObserverData) => void | Promise<void>;
}
type ObserverLevel = "error" | "warn" | "info" | "debug";
type ObserverData = Record<string, string | number | boolean | undefined>; // primitives only — can't carry a payload
interface ErrorReport {
  op: ObservedOp;
  stream?: StorageStream;
  error: unknown;
  code?: string;
}
```

`HookEvent` is a discriminated union over `phase`:

| Variant        | Extra fields          | Fires                                                                                                              |
| -------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `HookPre`      | —                     | before the work                                                                                                    |
| `HookProgress` | `step: string`        | mid multi-step op (`rebuild`: `no_stored`/`stale`/`current`; `forget`: `loaded`/`stripped`/`overwritten`/`binned`) |
| `HookSuccess`  | `durationMs`, `data?` | after success                                                                                                      |
| `HookFailure`  | `durationMs`, `error` | after failure                                                                                                      |

`ObservedOp` is closed and exhaustive — the 5 repository ops plus the 7 storage port calls: `create`, `load`, `commit`, `rebuild`, `forget`, `head`, `read`, `append`, `overwrite`, `loadProjection`, `saveProjection`, `deleteProjections`.

**Three guarantees:** async-safe (never awaited, throws swallowed), passive (return values change nothing), metadata-only (the `ObserverData` type forbids payloads — it can't leak PII).

### `consoleObserver(options?)`

```ts
const consoleObserver: (options?: { level?: ObserverLevel }) => Observer;
```

A batteries-included logger-only observer. Quiet at `info` (failures only); pass `{ level: "debug" }` for the full pre/success/failure trace.

---

## Cross-stream read models

::: warning Advanced — past the ORM line
A read model folds events across **all** streams in global commit order — the "data on the outside" / firehose shape the rest of the library deliberately avoids. It's an opt-in capability, available only on adapters that can offer a global [feed](#feed). If you don't need a cross-aggregate view, you don't need any of this.
:::

### `readModel(name, schema, initial)`

```ts
const readModel: <State>(name: string, schema: ZodType<State>, initial: State) => ReadModelDefinition<State>;
```

Unlike a projection, a read model takes an **explicit `initial` seed** (there's no creating event in a firehose).

| Member                 | Signature                                                                                                                     | Description                                                                                                                                                                                       |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.on(event, handler)`  | `<P = unknown>(event: EventDefinition, handler: (state: State, event: TypedEvent<P>) => State) => ReadModelDefinition<State>` | Registers a handler for one event topic. Throws [`TOPIC_DUPLICATE`](/reference/error-index#persistence-readmodelerrors) / [`MAPPER_INVALID`](/reference/error-index#persistence-readmodelerrors). |
| `.fold(events, from?)` | `(events: EventEnvelopeV1Type[], from?: State) => State`                                                                      | Folds a batch of feed events into state. Validates output ([`OUTPUT_INVALID`](/reference/error-index#persistence-readmodelerrors)).                                                               |

### `processor(deps)`

```ts
const processor: (deps: { feed: StorageFeedI; store: ReadModelStoreI }) => ProcessorI;
```

| Method                      | Signature                                                            | Description                                                                                                                                                                       |
| --------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.catchUp(model, options?)` | `<State>(model, options?: { batchSize?: number }) => Promise<State>` | Pulls and folds from the saved checkpoint until the feed drains, saving after each batch. Resumable and at-least-once (handlers must be idempotent). `batchSize` defaults to 500. |
| `.rebuild(model, options?)` | `<State>(model, options?) => Promise<State>`                         | Discards checkpoint and state and re-folds from the start of the (possibly redacted) feed — the post-forget purge path.                                                           |

### `StorageFeedI` {#feed}

```ts
interface StorageFeedI {
  readFeed(after: FeedCursor | undefined, limit: number): Promise<FeedPage>;
}
```

A global, resumable, cursor-paged feed across all streams in commit order. Not part of `StorageI` — an adapter that can't offer global ordering simply doesn't, and cross-stream read models are then unavailable on it. The feed reflects in-place redactions, so it can't surface erased PII. Shapes: [`FeedEntry` / `FeedPage`](/reference/data-models#feedentry-feedpage-the-global-feed), [`StoredReadModelV1`](/reference/data-models#storedreadmodelv1-a-cross-stream-read-model).

---

## Configuration & seams

| Export                                                 | Shape                                                        | Notes                                                                                                                                                                             |
| ------------------------------------------------------ | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Destinations`                                         | `{ events: string; projections: string; registry?: string }` | Where each kind lives — an adapter table/collection/prefix. `registry` defaults to `events`. The library targets one destination per operation and never coordinates across them. |
| `RegistryI`                                            | `{ head(stream): Promise<number \| undefined> }`             | A named view over the event head; what self-healing reads.                                                                                                                        |
| `ProjectionStoreI`                                     | `{ load; save; delete }`                                     | A thin wrapper over the projection half of the port, keyed by `(stream, name)`.                                                                                                   |
| `StoredProjectionV1`, `StoredReadModelV1`              | Zod schemas                                                  | See the [data model reference](/reference/data-models).                                                                                                                           |
| `StorageErrors`, `RepositoryErrors`, `ReadModelErrors` | enums                                                        | See the [error index](/reference/error-index).                                                                                                                                    |

---

## `runConformance(makeStorage)` {#conformance}

```ts
const runConformance: (makeStorage: () => Promise<StorageI>) => void;
```

The shared contract suite **every** adapter must pass — the official Postgres / Mongo / S3 adapters and yours alike. It's derived from the `StorageI` contract, not from any one implementation: assertions check contract facts (head advances, conflicts write nothing, overwrite is all-or-nothing, hostile keys round-trip, concurrent appends resolve to exactly one winner) and never branch on adapter type. You supply a fixture that yields a fresh, empty `StorageI`; the suite does the rest.

```ts
import { runConformance } from "@hilaryosborne/sourcing-persistence";

runConformance(async () => makeMyAdapter()); // certify your adapter against the same bar
```

## ➡️ Next

- [API: core](/reference/api-core) — the builders that feed the repository.
- [Data model reference](/reference/data-models) · [Error index](/reference/error-index)
- Guides: [Storage adapters](/guide/storage-adapters) · [Observability](/guide/observability)
