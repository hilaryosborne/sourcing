# 🐘 Self-healing read models (Postgres)

This is the example for people who don't trust a happy-path demo — and they're right not to. Here the domain is deliberately tiny (a counter), so the **storage story is the star**: events appended under optimistic concurrency to real Postgres, a read model that heals itself on demand, and observability wired through one seam so you can watch every operation in production.

The whole thing runs against a real database. Nothing is faked.

## 🧱 The domain (kept small on purpose)

Two events, one aggregate, one projection. A counter that gets opened with a name, then incremented.

```ts
import { event, aggregate, projection } from "@hilaryosborne/sourcing";
import { object, string, number } from "zod";

// Events: an opaque versioned topic + a Zod payload schema. create() validates eagerly.
const CounterOpened = event("counter.opened");
CounterOpened.version(1, object({ name: string().min(1) }));
const CounterIncremented = event("counter.incremented");
CounterIncremented.version(1, object({ by: number().int().positive() }));

// Aggregate: a name + the events legal on its stream.
const Counter = aggregate("counter");
Counter.register(CounterOpened);
Counter.register(CounterIncremented);

// Projection: a read model { name, total }. The opening event establishes the whole shape;
// every other handler spreads ...current. (Projections have no initial seed — see the note.)
const Total = projection("total", object({ name: string(), total: number() }));
Total.aggregate(Counter);
Total.handle<{ name: string }>(CounterOpened, (current, e) => ({ ...current, name: e.payload.name, total: 0 }));
Total.handle<{ by: number }>(CounterIncremented, (current, e) => ({ ...current, total: current.total + e.payload.by }));
```

That's the entire domain. `e.payload` is typed where we annotate the handler (`handle<P>`) and runtime-validated against each event's schema. Now we make it durable.

## 🔌 Wire the Postgres adapter

The repository talks to Postgres through a **client port** — a thin adapter over the `pg` driver, so the library never pins a driver version. The port is a single `query` method that returns `{ rows, rowCount }`.

```ts
import { Pool } from "pg";
import { repository, consoleObserver } from "@hilaryosborne/sourcing-persistence";
import { postgresStorage, type PgClientPort } from "@hilaryosborne/sourcing-adapter-postgres";

// Use a Pool, not a single Client, so concurrent appends race truthfully.
const pool = new Pool({ host, port, user, password, database });

const pgClient: PgClientPort = {
  query: async (sql, params) => {
    const res = await pool.query(sql, params ? [...params] : undefined);
    return { rows: res.rows, rowCount: res.rowCount ?? 0 }; // surface the driver's SQLSTATE unchanged
  },
};

// postgresStorage is async — it does its one-time table + index setup here. Await it.
const storage = await postgresStorage(pgClient, {
  events: "counter_events",
  projections: "counter_projections",
});

const repo = repository({ storage, observer: consoleObserver() });
```

::: info One-time Postgres reality
At construction, the adapter creates its tables **and** the `(stream, position)` **unique index**. That index isn't a nicety — it _is_ the compare-and-append. When two appends race for the same position, Postgres raises a unique-violation (SQLSTATE `23505`), and the adapter maps it straight to `VERSION_CONFLICT`. The optimistic-concurrency guarantee is a database constraint, not application code you have to trust.
:::

## ✍️ The write path

`create` mints a fresh instance, you stage events onto it, and `commit` appends them — advancing the stream head under optimistic concurrency.

```ts
// A fresh aggregate. Core mints the id; nothing is persisted yet.
const opening = await repo.create(Counter);

// creator is REQUIRED — a permanent fact refuses to exist without provenance. headers are optional.
opening.events.add(CounterOpened.create({ name: "signups" }).creator("user", "ada"));
opening.events.add(CounterIncremented.create({ by: 1 }).creator("user", "ada"));

// Append the staged events, advance the head, fold staged → committed.
await repo.commit(opening);

const id = opening.id; // hold onto this — it's the stream id for every later read
```

To add more facts later, `load` the stream back into `committed`, stage, and `commit` again:

```ts
const counter = await repo.load(Counter, id); // reads the full stream into `committed`
counter.events.add(CounterIncremented.create({ by: 5 }).creator("user", "ada"));
await repo.commit(counter); // head advances again
```

Each `commit` appends contiguously from the current head. Stage out of order and you'll get `APPEND_NOT_CONTIGUOUS` — a sequencing bug in your code, distinct from a concurrency race.

## 💚 The self-healing read

Here is the payoff. You never track whether a read model is stale. You call `rebuild`, and it makes **one cheap head read** and takes the cheapest correct path.

```ts
const total = await repo.rebuild({ aggregate: Counter, id, projection: Total });
// → { name: "signups", total: 6 }
```

Three outcomes, and `rebuild` picks between them for you on every call:

| Stored projection vs. stream head | What `rebuild` does                                          | Cost                         |
| --------------------------------- | ------------------------------------------------------------ | ---------------------------- |
| **none stored**                   | read the full stream, build from scratch, save               | full read + full fold        |
| **head > bookmark** (stale)       | read **only the delta**, fold it over the stored state, save | delta read + delta fold      |
| **head == bookmark** (current)    | return the stored state — **no event fetch**                 | **one head read, that's it** |

That last row is the win that makes this production-grade. When the projection is already current, `rebuild` reads the head, sees the bookmark already matches, and **returns the cached state without touching the events table**. No stream scan. No fold. Call it in a hot read path a thousand times against an unchanged stream and you pay a thousand cheap head reads — never a thousand stream rebuilds.

And because projections are pure folds, they hold no independent truth. Bin them, corrupt them, lose them — `rebuild` heals back to correct from the events. That's the same property that makes [right-to-forget](/guide/right-to-forget) tractable.

## 🔁 Optimistic concurrency, for real

In a real workload two requests will eventually try to commit to the same stream at the same time. One wins; the other's append loses the race against that unique index and surfaces `VERSION_CONFLICT`. That's not a fault — it's the system telling you someone committed first. **Catch it and retry the load → stage → commit cycle.**

```ts
import { StorageErrors } from "@hilaryosborne/sourcing-persistence";

async function incrementBy(by: number) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const counter = await repo.load(Counter, id); // re-read the current head every attempt
    counter.events.add(CounterIncremented.create({ by }).creator("user", "ada"));

    try {
      await repo.commit(counter); // races the unique (stream, position) index
      return; // won the race — done
    } catch (err) {
      // mechanical errors are thrown as `new Error(StorageErrors.X)`, so match on the message
      if (err instanceof Error && err.message === StorageErrors.VERSION_CONFLICT) continue; // someone beat us; reload and retry
      throw err; // anything else is a real failure
    }
  }
  throw new Error("too much contention on this stream");
}
```

The retry **re-loads** before re-staging — that's what makes it correct, not just a blind replay. You fold your new fact onto the head as it actually is now, not as it was when you first tried.

## 📡 Observability — watch it in production

The repository is **silent by default**. Pass a single `observer` and you light up every operation. We already wired `consoleObserver()` above; here's the production shape — three independent channels mapping onto the three things an ops team wants:

```ts
const repo = repository({
  storage,
  observer: {
    // Splunk-shaped structured logs: pre/success at debug, failure at error.
    logger: { info: splunk.send, warn: splunk.send, error: splunk.send, debug: splunk.send },
    // New Relic-shaped error tracking: the actual Error object + context.
    report: (r) => newrelic.noticeError(r.error, { op: r.op, code: r.code, stream: r.stream?.id }),
    // Metrics / OTel profiling: every op fires pre → success | failure with a measured durationMs.
    hook: (e) => {
      if (e.phase === "success") metrics.timing(e.code, e.durationMs);
    },
  },
});
```

Two signals are worth calling out for this example specifically:

- **`rebuild`'s progress hook reports the path it took** — `no_stored`, `stale`, or `current`. That field _is_ your projection cache-hit ratio: the proportion of `current` versus the rest is exactly how often you took the cheap, no-event-fetch path. Graph it and you can see the self-healing read paying for itself.
- **`durationMs` on every `success`/`failure`** gives you free profiling — latency on `commit`, `load`, `rebuild`, and each of the underlying storage port calls (`head`, `read`, `append`, …), no instrumentation code of your own.

The library **never awaits your observer** and swallows any throw — a slow or broken telemetry sink can neither slow nor break a storage operation. One caveat for retries: `VERSION_CONFLICT` is expected and frequent, so filter it in your error sink if you don't want it raising alarms. Full detail in [Observability](/guide/observability).

## ✅ What you just saw

A complete production-shaped read model, end to end:

- **A tiny domain** — two events, one aggregate, one `{ name, total }` projection — so the storage mechanics stayed front and centre.
- **Real Postgres wiring** — a `PgClientPort` over a `pg` `Pool`, `await postgresStorage(...)`, `repository({ storage })`. The adapter built its tables and the `(stream, position)` unique index that does the compare-and-append.
- **The write path** — `create` → `events.add` (with the required `creator`) → `commit`, appending contiguously and advancing the head.
- **The self-healing read** — one `rebuild` call, three outcomes, and the cache-hit win where a current projection returns with **no event fetch at all**.
- **Optimistic concurrency for real** — catching `StorageErrors.VERSION_CONFLICT` and retrying the load → stage → commit cycle, with the re-load that makes the retry correct.
- **Observability through one seam** — three channels, with `rebuild`'s progress path as your cache-hit ratio and `durationMs` as free profiling.

Where to next:

- [Storage adapters](/guide/storage-adapters) — the exact wiring for Postgres, Mongo, and S3, the full error set, and the trade-offs each backend makes.
- [Observability](/guide/observability) — the three channels in depth, the exhaustive op set, and the structural PII guarantees.
