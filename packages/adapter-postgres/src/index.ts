// Public API barrel for @hilaryosborne/sourcing-adapter-postgres — the relational
// implementation of StorageI (the easy backend, the inverse stress test of S3),
// conformance-certified against real Postgres. The Postgres client is INJECTED via
// PgClientPort, so the concrete `pg` wiring lives with the consumer.
export { postgresStorage } from "./pg-storage";
export { isUniqueViolation } from "./pg-client";
export type { PgClientPort, PgRows } from "./pg-client";
