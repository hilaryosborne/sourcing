# Observability

The repository is **silent by default**. It is a storage layer — it never logs, never reports, never emits a metric unless you ask it to. The single optional `observer` you pass to `repository({ storage, observer })` is that seam: one interface you implement to wire the repository into your platform. Supply none and instrumentation is skipped entirely — the quiet default costs nothing.

For how the repository itself is composed, see [Storage adapters](/guide/storage-adapters).

## The three channels

The `Observer` interface has three **independent** channels. Every one is optional — implement only the sink you actually wire. They map cleanly onto the three things an operations team wants from a storage layer:

| Channel  | Shape                                       | Maps to                    |
| -------- | ------------------------------------------- | -------------------------- |
| `logger` | `error / warn / info / debug(event, data?)` | Splunk — structured logs   |
| `report` | `(report: ErrorReport) => …`                | New Relic — error tracking |
| `hook`   | `(event: HookEvent) => …`                   | metrics / OTel — profiling |

```ts
import { repository, consoleObserver } from "@hilaryosborne/sourcing-persistence";

const repo = repository({
  storage,
  observer: {
    // logging (Splunk-shaped): leveled, structured events — pre/success at debug, failure at error
    logger: { info: splunk.send, warn: splunk.send, error: splunk.send, debug: splunk.send },
    // error reporting (New Relic-shaped): the actual Error object + context
    report: (r) => newrelic.noticeError(r.error, { op: r.op, code: r.code, stream: r.stream?.id }),
    // profiling (metrics): every operation fires pre → success | failure with a measured durationMs
    hook: (e) => {
      if (e.phase === "success") metrics.timing(e.code, e.durationMs);
    },
  },
});
```

### `logger` — leveled structured logs

The `Logger` is the Splunk-shaped sink: a free-text event key plus structured `data`, one method per `ObserverLevel` (`error` / `warn` / `info` / `debug`). The house idiom is a `BRAND_EVENT_NAME` event key — e.g. `"SOURCING_COMMIT_OK"`. The library narrates `pre`/`success` at `debug` and `failure` at `error`, so this channel **alone tells the whole story**: forward each line to Splunk as a structured event and you have a complete operational narrative.

### `report` — the Error object for error tracking

Unlike the other two channels, `report` carries the **actual thrown value**, so you can hand it straight to an error tracker. The `ErrorReport` is `{ op, stream?, error, code? }`, where `code` is the mechanical error code when known (a `StorageErrors` / `RepositoryErrors` value):

```ts
report: (r) => newrelic.noticeError(r.error, { op: r.op, code: r.code, stream: r.stream?.id });
```

::: info
`VERSION_CONFLICT` is **expected and frequent** — it is how optimistic-concurrency retries surface, not a fault. Filter it in your sink if you do not want it raising alerts.
:::

### `hook` — the lifecycle for profiling

`hook` receives a `HookEvent`: a discriminated union over `op` × `phase`. Every operation fires `pre` before the work and `success` or `failure` after it; multi-step operations also fire `progress`. The `success` and `failure` events carry `durationMs` — the profiling signal — and `success` carries op-specific `data` (counts, positions, the rebuild path). Switch on `event.phase` (and `event.op`) to time operations, count outcomes, and watch the self-healing cache-hit ratio.

## `consoleObserver()` — batteries included

You do not have to write an observer to get started. `consoleObserver()` is the bundled default — a logger-only observer that writes to the console. It is **quiet at `info`** (failures only), so wiring it costs you nothing in noise:

```ts
import { repository, consoleObserver } from "@hilaryosborne/sourcing-persistence";

const repo = repository({ storage, observer: consoleObserver() });
// failures only

const verbose = repository({ storage, observer: consoleObserver({ level: "debug" }) });
// the full pre/success/failure trace
```

Pass `{ level: "debug" }` for the full trace. It is a batteries-included convenience, not a dependency you carry into production — most consumers ship their own plugin for Splunk, New Relic, OpenTelemetry, Datadog, or whatever their platform speaks.

## What fires: the exhaustive op set

`ObservedOp` is closed and exhaustive — the **5 repository operations** plus the **7 storage port calls** the repository makes:

- **Repository operations:** `create`, `load`, `commit`, `rebuild`, `forget`
- **Storage port calls:** `head`, `read`, `append`, `overwrite`, `loadProjection`, `saveProjection`, `deleteProjections`

Every one fires the full lifecycle — `pre` → `success | failure` with a measured `durationMs` — and the multi-step ones also fire `progress`. Out of this you get latencies, throughput, and error rates for free.

### `rebuild`'s progress step is the cache-hit ratio

`rebuild` is the self-healing read, and its `progress` step reports **which path it took**:

- `no_stored` — no cached projection; full build from the stream.
- `stale` — head moved past the bookmark; fold only the delta.
- `current` — head equals the bookmark; return the stored state, no event fetch.

That progress step **is your projection cache-hit ratio**: the proportion of `current` versus `no_stored`/`stale` is exactly how often the cheap path was taken. (`forget` likewise reports its stages — `loaded` / `stripped` / `overwritten` / `binned` — through `progress`.)

## Three guarantees that matter

### 1. Async-safe and non-blocking

The console is synchronous; a Splunk HEC endpoint and a New Relic agent are not. So every channel method may return a `Promise`, and the library **never `await`s your observer** — it fires and forgets, and **swallows any throw or rejection**. A slow or broken telemetry sink can neither slow nor break a storage operation.

::: warning
Because the library never awaits delivery, **delivery guarantees are the plugin's concern**. If you need them, buffer or queue inside your observer — do not rely on the repository to retry or flush.
:::

### 2. Passive — observation only

The hooks are **WordPress _actions_, not _filters_**: every method returns `void` (or a `Promise` of `void`), and nothing it returns alters what the library does. An observer can watch an append, a conflict, or a query — it cannot redirect, swallow, or rewrite one. To change storage behaviour, write an adapter, not an observer.

### 3. Metadata only — by type, not by discipline

`ObserverData` is typed `Record<string, string | number | boolean | undefined>` — **primitives only**. You cannot nest an event payload into a hook or a log line, because the type forbids it. This is a structural guarantee, not a convention you have to remember.

It matters acutely for an event store. Events carry PII, and [right-to-forget](/guide/right-to-forget) erases it. An observer that could emit payloads would do two damaging things at once: exfiltrate PII into your telemetry backend, and **silently defeat forget** — you can strip the event store, but you cannot strip Splunk. The type makes that class of leak unrepresentable.

::: tip
Instrumentation happens at the repository's **port boundary** — the seam where the repository calls storage. The storage adapters are never modified to be observable. One observer, wired once at the repository, sees every operation across whichever adapter you injected.
:::
