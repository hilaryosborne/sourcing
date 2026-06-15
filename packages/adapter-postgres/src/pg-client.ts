// The minimal Postgres surface the adapter needs, as an INJECTED port — the concrete `pg`
// client is supplied by the consumer. The Postgres adapter is the easy backend, built RIGHT
// AFTER S3 on purpose.
//
// Postgres is the inverse stress test of S3: where S3 had to EMULATE every guarantee, here
// they are native (unique constraints, UPDATE, cheap delta, cheap sequence). The risk flips
// from "the port asks too much" to "the adapter does it the clean native way the port can't
// promise across all three". So the discipline is: honor the SAME StorageI contract S3
// honors, and lean on NOTHING the universal port cannot assume.
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
// position) unique index: the stream moved since the caller loaded → VERSION_CONFLICT.
const UNIQUE_VIOLATION = "23505";
export const isUniqueViolation = (error: unknown): boolean =>
  typeof error === "object" && error !== null && (error as { code?: unknown }).code === UNIQUE_VIOLATION;
