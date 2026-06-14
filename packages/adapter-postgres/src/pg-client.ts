// DRAFT — Epic 4, Phase C (Postgres adapter — the easy backend, built RIGHT AFTER S3 on
// purpose). The minimal Postgres surface the adapter needs, as an INJECTED port — the
// concrete `pg` client is a Phase D wiring detail. Awaiting per-artefact ratification.
//
// Postgres is the inverse stress test of S3: where S3 had to EMULATE every guarantee, here
// they are native (unique constraints, UPDATE, cheap delta, cheap sequence). The risk flips
// from "the port asks too much" to "the adapter does it the clean native way the port can't
// promise across all three". So the discipline while drafting is: honor the SAME StorageI
// contract S3 honors, and lean on NOTHING the universal port cannot assume.
export interface PgRows<R> {
  rows: R[];
  rowCount: number;
}

export interface PgClientPort {
  // Run a parameterised statement. Rejects with the driver's error (carrying a SQLSTATE
  // `code`) on a database error — e.g. "23505" unique_violation, which the adapter maps to
  // VERSION_CONFLICT.
  query<R = unknown>(sql: string, params?: readonly unknown[]): Promise<PgRows<R>>;
}

// SQLSTATE 23505 — unique_violation. A second writer's INSERT collided on the (stream,
// position) primary key: the stream moved since the caller loaded → VERSION_CONFLICT.
const UNIQUE_VIOLATION = "23505";
export const isUniqueViolation = (error: unknown): boolean =>
  typeof error === "object" && error !== null && (error as { code?: unknown }).code === UNIQUE_VIOLATION;

// The schema. Two tables keyed per-stream. NOTE — DELIBERATELY NO GLOBAL SEQUENCE column:
// Postgres could trivially add a `bigserial` global order, but the universal port promises
// no cross-stream ordering (FOUNDATION §"Single adapter per repository"), and S3 cannot
// provide one. Ordering is per-stream by `position`. Not assuming what only Postgres can
// cheaply give is the whole point of building this adapter next to S3.
export const POSTGRES_SCHEMA = `
CREATE TABLE IF NOT EXISTS sourcing_events (
  stream_name text   NOT NULL,
  stream_id   text   NOT NULL,
  position    bigint NOT NULL,
  envelope    jsonb  NOT NULL,
  PRIMARY KEY (stream_name, stream_id, position)
);
CREATE TABLE IF NOT EXISTS sourcing_projections (
  stream_name text   NOT NULL,
  stream_id   text   NOT NULL,
  name        text   NOT NULL,
  position    bigint NOT NULL,
  state       jsonb  NOT NULL,
  PRIMARY KEY (stream_name, stream_id, name)
);
`;

// Apply the schema (idempotent). For Phase D setup / conformance bootstrap.
export const migrate = async (pg: PgClientPort): Promise<void> => {
  await pg.query(POSTGRES_SCHEMA);
};
