# 🐘 Postgres adapter

`@hilaryosborne/sourcing-adapter-postgres` persists events and projections to PostgreSQL. It's the **default recommendation** for most applications: transactional, with genuinely cheap delta reads, and the simplest operational story of the three.

## When to choose it

- You want **cheap stale-delta reads** — Postgres reads only the new events on a stale `rebuild`, so self-healing is at its best here.
- You already run Postgres, or want one boring, well-understood datastore.
- You may want cross-stream ordering later (a single Postgres can offer a global feed cheaply).

## Install

```sh
npm install @hilaryosborne/sourcing-persistence @hilaryosborne/sourcing-adapter-postgres pg
```

## Wire the client port

The adapter never imports `pg` directly — you inject a tiny **client port** (a single `query`) over your driver, so the library never depends on a specific driver version:

```ts
import { Pool } from "pg";
import { postgresStorage, type PgClientPort } from "@hilaryosborne/sourcing-adapter-postgres";
import { repository } from "@hilaryosborne/sourcing-persistence";

const pool = new Pool({ host, port, user, password, database });

const pgClient: PgClientPort = {
  query: async (sql, params) => {
    const res = await pool.query(sql, params ? [...params] : undefined);
    return { rows: res.rows, rowCount: res.rowCount ?? 0 }; // surface the driver's SQLSTATE code unchanged
  },
};

const storage = await postgresStorage(pgClient, { events: "account_events", projections: "account_projections" });
const repo = repository({ storage });
```

::: tip Use a `Pool`, not a single `Client`
Concurrent appends must race truthfully against the unique index. A single shared `Client` serialises queries and hides the race a `Pool` exposes.
:::

## What it creates

`postgresStorage` is **async** because it creates its tables and indexes at construction (idempotently — `CREATE … IF NOT EXISTS`). There's no migration step to run:

```sql
CREATE TABLE IF NOT EXISTS account_events (
  stream_name text  NOT NULL,
  stream_id   text  NOT NULL,
  position    bigint NOT NULL,
  envelope    jsonb NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS account_events_stream_position
  ON account_events (stream_name, stream_id, position);

CREATE TABLE IF NOT EXISTS account_projections (
  stream_name text  NOT NULL,
  stream_id   text  NOT NULL,
  name        text  NOT NULL,
  position    bigint NOT NULL,
  state       jsonb NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS account_projections_stream_name
  ON account_projections (stream_name, stream_id, name);
```

The `(stream_name, stream_id, position)` **unique index is the compare-and-append** — it's a precondition, not an optimisation. The adapter ensures it at construction so the no-index state is unreachable. Append maps a unique-violation (SQLSTATE `23505`) to [`VERSION_CONFLICT`](/reference/error-index#persistence-storageerrors).

Table/index names come from the `destinations` map (defaults: `sourcing_events`, `sourcing_projections`). Identifiers are validated against `^[A-Za-z_][A-Za-z0-9_]*$` and interpolated — they're trusted config, never user input.

## Constraints & trade-offs

- **Cheap deltas** — a stale `rebuild` reads only events after the bookmark. This is the adapter to pick when delta-read cost matters.
- **Multi-event appends are atomic** — a single multi-row `INSERT` statement.
- **Configurable destinations** are locations, not coordination — the library never makes an operation atomic across two tables. ([destinations →](/guide/storage-adapters#configurable-destinations))

## ➡️ Next

- [The repository & self-healing](/guide/repository) — the read/write path over this adapter.
- [Self-healing on Postgres](/examples/self-healing-postgres) — a full worked example with retries and observability.
- [Storage adapters: overview](/guide/storage-adapters) — compare the three.
