// DRAFT — Epic 4, Phase C. Public API barrel for @hilaryosborne/sourcing-adapter-postgres —
// the relational implementation of StorageI (the easy backend, the inverse stress test of
// S3). The Postgres client is INJECTED via PgClientPort, so the concrete `pg` wiring is a
// Phase D detail. Awaiting per-artefact ratification of the native-CAS append and
// UPDATE-by-(stream, position) shapes before the conformance suite locks the contract.
export { postgresStorage } from "./pg-storage";
export { POSTGRES_SCHEMA, migrate, isUniqueViolation } from "./pg-client";
export type { PgClientPort, PgRows } from "./pg-client";
