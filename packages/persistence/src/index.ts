// DRAFT — Epic 4, Phase A (redraft). Public API surface for
// @hilaryosborne/sourcing-persistence — the repository. The barrel IS the public API
// (interface-adapters §"Barrels are the public API"): what is exported here is the
// contract; anything not exported is internal. Awaiting per-artefact ratification
// (DRAFT-AND-HALT.md). Nothing here is implemented — every factory throws.
//
// Four artefacts are on the table, each its own ratification gate:
//   1. the storage interface (the port every adapter implements)
//   2. the aggregate registry contract
//   3. the projection store contract
//   4. the repository (write path + self-healing read path + right-to-forget)

// --- The storage interface (the port adapters implement) ---
export type { StorageI, StorageEventsI, StorageProjectionsI } from "./storage/storage.interface";
export { StorageErrors } from "./storage/storage.errors";
export { StoredProjectionV1 } from "./storage/storage.model";
export type { StorageStream, StoredEventV1Type, StoredProjectionV1Type } from "./storage/storage.model";

// --- The aggregate registry ---
export { default as registry } from "./registry/registry";
export type { RegistryI } from "./registry/registry";

// --- The projection store ---
export { default as projectionStore } from "./projection-store/projection-store";
export type { ProjectionStoreI } from "./projection-store/projection-store";

// --- The repository (write path + self-healing + right-to-forget) ---
export { default as repository } from "./repository/repository";
export type { RepositoryI, RepositoryDeps, RebuildInput, ForgetInput } from "./repository/repository";
