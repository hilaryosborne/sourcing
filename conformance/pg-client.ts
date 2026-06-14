// Concrete PgClientPort over the real `pg` driver → the Postgres container (Phase D wiring).
// A POOL, not a single Client, on purpose: the conformance suite's concurrent-race cases issue
// overlapping appends, and only separate connections exercise a TRUE race against the unique
// index. One Client serializes every query, which would launder the race into a sequence and
// turn a green into a false green. The pool surfaces the driver's SQLSTATE `code` (23505)
// unchanged, which is the one fact the adapter reads.
import { Pool } from "pg";
import type { PgClientPort } from "@hilaryosborne/sourcing-adapter-postgres";

const pool = new Pool({
  host: "127.0.0.1",
  port: 5433,
  user: "postgres",
  password: "postgres",
  database: "postgres",
});

export const pgClient = (): PgClientPort => ({
  query: async (sql, params) => {
    const res = await pool.query(sql, params ? [...params] : undefined);
    return { rows: res.rows, rowCount: res.rowCount ?? 0 };
  },
});

export const closePgClient = (): Promise<void> => pool.end();
