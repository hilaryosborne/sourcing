// The StorageI implementation over a PgClientPort — the EASY backend, built right after S3 so
// the contrast is visible, and conformance-certified against real Postgres. It expresses the
// SAME contract S3 does; "native" does not change the port's shape or smuggle in a capability
// the port now leans on. The two load-bearing shapes are native-CAS append and
// UPDATE-by-(stream, position). No real `pg` here — port injected.
//
// DESTINATIONS: the consumer configures WHERE each kind lands at persistence-init; the
// adapter uses the configured TABLE name in place of a hardcoded one (FOUNDATION
// §"Configurable destinations"). Resolved once at construction (registry defaults to the
// events VALUE) and validated as a SQL identifier — a table name is interpolated, not a
// bound parameter, so it must be a trusted identifier, not free text.
//
// LAYOUT: one row per event keyed (stream_name, stream_id, position); projections one row
// each keyed (stream_name, stream_id, name). jsonb in/out: write JSON.stringify(value) with a
// ::jsonb cast; read returns already-parsed objects (node-pg). Positions are bigint → string
// out; Number() them (positions are bounded).
import type { EventEnvelopeV1Type } from "@hilaryosborne/sourcing";
import type { Destinations, StorageI, StoredProjectionV1Type } from "@hilaryosborne/sourcing-persistence";
import { resolveDestinations, StorageErrors, StoredProjectionV1 } from "@hilaryosborne/sourcing-persistence";
import type { PgClientPort } from "./pg-client";
import { isUniqueViolation } from "./pg-client";

// Batteries-included defaults; the consumer overrides any kind at construction.
const DEFAULT_DESTINATIONS: Destinations = { events: "sourcing_events", projections: "sourcing_projections" };

// A destination becomes a TABLE NAME interpolated into SQL, so it must be a safe identifier
// (it is trusted init config, never user input — but fail fast on a malformed one rather than
// open an injection seam).
const SQL_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const asIdentifier = (name: string): string => {
  if (!SQL_IDENTIFIER.test(name)) throw new Error(`invalid Postgres destination identifier: ${JSON.stringify(name)}`);
  return name;
};

// ASYNC factory: the (stream, position) UNIQUE INDEX is the compare-and-append, so it is a
// PRECONDITION, not optional setup — the SAME enforcement standard as the Mongo adapter. A
// table that exists but lacks the index (hand-provisioned, partial migration, skipped setup)
// would let INSERT SUCCEED on a duplicate position, silently voiding the CAS and passing every
// test against a properly-provisioned table. Ensuring the index here (idempotent; CREATE
// UNIQUE INDEX IF NOT EXISTS covers a pre-existing un-indexed table) makes that unreachable
// through this constructor. NO global sequence (deliberate; FOUNDATION §"Single adapter per
// repository"). NB: NOT a relitigation of the ratified append/overwrite mechanism — only the
// CAS precondition, brought to the Mongo standard.
export const postgresStorage = async (
  pg: PgClientPort,
  destinations: Partial<Destinations> = {},
): Promise<StorageI> => {
  const dest = resolveDestinations({ ...DEFAULT_DESTINATIONS, ...destinations });
  const eventsTable = asIdentifier(dest.events);
  const projectionsTable = asIdentifier(dest.projections);
  // dest.registry is intentionally unused: head reads the EVENTS table (the registry is a
  // view over the event head, ratified Gate 2). The slot exists for a materialized-registry
  // adapter; this reference adapter does not materialize one.

  await pg.query(
    `CREATE TABLE IF NOT EXISTS ${eventsTable} (stream_name text NOT NULL, stream_id text NOT NULL, position bigint NOT NULL, envelope jsonb NOT NULL)`,
  );
  await pg.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS ${eventsTable}_stream_position ON ${eventsTable} (stream_name, stream_id, position)`,
  );
  await pg.query(
    `CREATE TABLE IF NOT EXISTS ${projectionsTable} (stream_name text NOT NULL, stream_id text NOT NULL, name text NOT NULL, position bigint NOT NULL, state jsonb NOT NULL)`,
  );
  await pg.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS ${projectionsTable}_stream_name ON ${projectionsTable} (stream_name, stream_id, name)`,
  );

  return {
    head: async (stream) => {
      const res = await pg.query<{ head: string | null }>(
        `SELECT max(position) AS head FROM ${eventsTable} WHERE stream_name = $1 AND stream_id = $2`,
        [stream.name, stream.id],
      );
      const head = res.rows[0]?.head;
      return head === null || head === undefined ? undefined : Number(head);
    },

    // Cheap delta read — `position > after` over the primary-key index. Cheaper than S3's
    // whole-object read, but the SAME read() contract (events after `after`); the port never
    // promised cheapness and S3 honestly cannot provide it (FOUNDATION §"no cheap delta on
    // S3"). Cheaper here is fine; a DIFFERENT contract would not be.
    read: async (stream, after) => {
      const res = await pg.query<{ envelope: EventEnvelopeV1Type }>(
        `SELECT envelope FROM ${eventsTable}
         WHERE stream_name = $1 AND stream_id = $2 AND ($3::bigint IS NULL OR position > $3)
         ORDER BY position`,
        [stream.name, stream.id, after ?? null],
      );
      return res.rows.map((row) => row.envelope);
    },

    // ── ① NATIVE-CAS APPEND (re-surfaced, destination-parameterized) ──────────────────────
    // The (stream, position) PRIMARY KEY is the compare-and-append. One multi-row INSERT into
    // the configured events table:
    //   • all positions free → inserted atomically (single statement);
    //   • any position taken → unique_violation (23505) → VERSION_CONFLICT, whole INSERT rolls
    //     back. A stale writer's positions are already present, so it loses — exactly the fact
    //     S3's etag/key conflict means. No pre-read, no head fetch: the constraint IS the
    //     expected-head check. `expectedHead` is enforced structurally by the events' positions
    //     (the unique key) — identical in MEANING to S3, cheaper in MECHANISM.
    // The contiguity precondition stays its OWN error (caller bug, not a concurrency loss): the
    // unique key enforces no-duplicate but not no-GAP, so APPEND_NOT_CONTIGUOUS is still
    // load-bearing, the same as on S3.
    append: async (stream, events, expectedHead) => {
      if (events.length === 0) {
        // Empty append honors expectedHead (Reading B): the compare is a precondition asserted
        // whenever given, not a write-guard. Nothing to write, but a stale expectedHead conflicts.
        if (expectedHead === undefined) return;
        const res = await pg.query<{ head: string | null }>(
          `SELECT max(position) AS head FROM ${eventsTable} WHERE stream_name = $1 AND stream_id = $2`,
          [stream.name, stream.id],
        );
        const raw = res.rows[0]?.head;
        const head = raw === null || raw === undefined ? undefined : Number(raw);
        if (head !== expectedHead) throw new Error(StorageErrors.VERSION_CONFLICT);
        return;
      }
      const expectedStart = (expectedHead ?? -1) + 1;
      if (events[0]!.position !== expectedStart) throw new Error(StorageErrors.APPEND_NOT_CONTIGUOUS);

      const rows: string[] = [];
      const params: unknown[] = [stream.name, stream.id];
      events.forEach((event, index) => {
        const base = index * 2;
        rows.push(`($1, $2, $${base + 3}::bigint, $${base + 4}::jsonb)`);
        params.push(event.position, JSON.stringify(event));
      });
      try {
        await pg.query(
          `INSERT INTO ${eventsTable} (stream_name, stream_id, position, envelope) VALUES ${rows.join(", ")}`,
          params,
        );
      } catch (error) {
        if (isUniqueViolation(error)) throw new Error(StorageErrors.VERSION_CONFLICT);
        throw error;
      }
    },

    // ── ② OVERWRITE BY (stream, position) (re-surfaced, destination-parameterized) ────────
    // Right-to-forget as a native UPDATE, matched by (stream, position), never a uid scan —
    // the same contract S3 established, done the easy way. ALL-OR-NOTHING on a miss, like S3:
    // the CTE only updates when EVERY target position is present (the count guard), so a miss
    // updates nothing and we throw OVERWRITE_UNKNOWN_POSITION with the stream untouched. (A
    // plain UPDATE ... FROM would partially redact then report a short rowCount — observably
    // different from S3; the guard keeps the two adapters identical.)
    //
    // Why the count guard proves the right POSITIONS, not just the right NUMBER: `present` is
    // the existence-JOIN of input against the stream, so each input row contributes 1 iff its
    // position exists — count(present) = count(input) therefore means EVERY input position is
    // present (a genuine miss lowers present below input and cannot be masked). Input positions
    // are unique by construction (forget redacts each event once); the second guard,
    // count(DISTINCT position) = count(*), makes that no-duplicate assumption FAIL-LOUD rather
    // than let a duplicate drive a nondeterministic UPDATE ... FROM match.
    overwrite: async (stream, redactions) => {
      if (redactions.length === 0) return;
      const tuples: string[] = [];
      const params: unknown[] = [stream.name, stream.id];
      redactions.forEach((event, index) => {
        const base = index * 2;
        tuples.push(`($${base + 3}::bigint, $${base + 4}::jsonb)`);
        params.push(event.position, JSON.stringify(event));
      });
      const res = await pg.query<{ updated: number }>(
        `WITH input(position, envelope) AS (VALUES ${tuples.join(", ")}),
              present AS (
                SELECT i.position FROM input i
                JOIN ${eventsTable} e
                  ON e.stream_name = $1 AND e.stream_id = $2 AND e.position = i.position
              ),
              updated AS (
                UPDATE ${eventsTable} e SET envelope = i.envelope
                FROM input i
                WHERE e.stream_name = $1 AND e.stream_id = $2 AND e.position = i.position
                  AND (SELECT count(*) FROM present) = (SELECT count(*) FROM input)
                  AND (SELECT count(DISTINCT position) FROM input) = (SELECT count(*) FROM input)
                RETURNING 1
              )
         SELECT count(*)::int AS updated FROM updated`,
        params,
      );
      if ((res.rows[0]?.updated ?? 0) !== redactions.length) throw new Error(StorageErrors.OVERWRITE_UNKNOWN_POSITION);
    },

    loadProjection: async (stream, name) => {
      const res = await pg.query<{ position: string; state: unknown }>(
        `SELECT position, state FROM ${projectionsTable} WHERE stream_name = $1 AND stream_id = $2 AND name = $3`,
        [stream.name, stream.id, name],
      );
      const row = res.rows[0];
      if (!row) return undefined;
      return StoredProjectionV1.parse({
        aggregate: { id: stream.id, name: stream.name },
        name,
        position: Number(row.position),
        state: row.state,
      }) as StoredProjectionV1Type;
    },

    // Upsert — last-write-wins (a derived cache), like S3's unconditional projection put.
    saveProjection: async (stored) => {
      await pg.query(
        `INSERT INTO ${projectionsTable} (stream_name, stream_id, name, position, state)
         VALUES ($1, $2, $3, $4::bigint, $5::jsonb)
         ON CONFLICT (stream_name, stream_id, name) DO UPDATE SET position = EXCLUDED.position, state = EXCLUDED.state`,
        [stored.aggregate.name, stored.aggregate.id, stored.name, stored.position, JSON.stringify(stored.state)],
      );
    },

    // Bin every projection for the stream — at the configured PROJECTION destination, never
    // one derived from the event location (forget's bin-all thread-through). A single DELETE.
    deleteProjections: async (stream) => {
      await pg.query(`DELETE FROM ${projectionsTable} WHERE stream_name = $1 AND stream_id = $2`, [
        stream.name,
        stream.id,
      ]);
    },
  };
};
