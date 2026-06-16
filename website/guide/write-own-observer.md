# 📡 Write your own observer

The repository is silent until you give it an `observer`. That one optional seam is how you wire storage operations into your platform — Splunk, New Relic, OpenTelemetry, Datadog, whatever you run. The [Observability guide](/guide/observability) covers the design; this page is how to _build_ one.

## The shape

An `Observer` has three independent channels. Implement only the ones you wire — each is optional:

```ts
import type { Observer } from "@hilaryosborne/sourcing-persistence";

const observer: Observer = {
  logger: { error, warn, info, debug }, // structured logs (Splunk-shaped)
  report: (report) => {
    /* … */
  }, // the Error object, for error tracking
  hook: (event) => {
    /* … */
  }, // the lifecycle, for profiling/metrics
};
```

## A platform observer, end to end

A realistic wiring — structured logs to your log pipeline, errors to a tracker, timings and the cache-hit ratio to metrics:

```ts
import { repository, type Observer } from "@hilaryosborne/sourcing-persistence";
import { StorageErrors } from "@hilaryosborne/sourcing-persistence";

const observer: Observer = {
  // 1 — logger: leveled, structured. The library narrates pre/success at debug, failure at error.
  logger: {
    debug: (event, data) => log.debug(event, data),
    info: (event, data) => log.info(event, data),
    warn: (event, data) => log.warn(event, data),
    error: (event, data) => log.error(event, data),
  },

  // 2 — report: the actual thrown value, for an error tracker. Filter the expected ones.
  report: (r) => {
    if (r.code === StorageErrors.VERSION_CONFLICT) return; // expected & frequent — never alert on it
    errorTracker.capture(r.error, { op: r.op, code: r.code, stream: r.stream?.id });
  },

  // 3 — hook: the lifecycle, for metrics. success/failure carry durationMs; rebuild's progress
  //     step IS your projection cache-hit ratio.
  hook: (e) => {
    if (e.phase === "success") metrics.timing(`sourcing.${e.op}`, e.durationMs);
    if (e.phase === "failure") metrics.increment(`sourcing.${e.op}.error`);
    if (e.phase === "progress" && e.op === "rebuild") metrics.increment(`sourcing.rebuild.${e.step}`); // no_stored | stale | current
  },
};

const repo = repository({ storage, observer });
```

The `rebuild` progress step (`no_stored` / `stale` / `current`) is the most valuable single signal: the proportion of `current` is how often the cheap path was taken — your projection cache-hit ratio, for free. ([the op set →](/guide/observability#what-fires-the-exhaustive-op-set))

## The three guarantees you're building against

The library holds up three contracts so your observer can't hurt it — design within them:

1. **Async-safe, fire-and-forget.** Every channel method may return a `Promise`, and the library **never awaits it and swallows any throw**. A slow Splunk or a broken agent can't slow or break a commit. The flip side: **delivery is your concern** — if you need it, buffer or queue _inside_ your observer.
2. **Passive.** Methods return `void`. Nothing you return changes what the library does — an observer watches, it never redirects. To change behaviour, write an adapter, not an observer.
3. **Metadata only — by type.** `ObserverData` is `Record<string, string | number | boolean | undefined>`. You _cannot_ nest an event payload into a log line or hook — the type forbids it. This is the structural guarantee that telemetry can't exfiltrate PII or [silently defeat right-to-forget](/guide/observability#_3-metadata-only-by-type-not-by-discipline).

## Don't want to write one yet?

`consoleObserver()` is batteries-included — a logger-only observer, quiet at `info` (failures only). Pass `{ level: "debug" }` for the full trace. It's a convenience for getting started, not something to ship; most consumers write their own for their platform.

```ts
import { consoleObserver } from "@hilaryosborne/sourcing-persistence";

const repo = repository({ storage, observer: consoleObserver({ level: "debug" }) });
```

## ➡️ Next

- [Observability](/guide/observability) — the channel reference and guarantees in depth.
- [API: persistence](/reference/api-persistence#the-observer-seam) — exact types (`HookEvent`, `ObservedOp`, …).
- [Write your own storage adapter](/guide/write-own-adapter) — the other extension seam.
