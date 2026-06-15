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

// --- Configurable destinations (the non-prohibition seam) ---
export { resolveDestinations } from "./destinations/destinations";
export type { Destinations, ResolvedDestinations } from "./destinations/destinations";

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
export { RepositoryErrors } from "./repository/repository.errors";

// --- Observability (the optional logging / error-reporting / profiling seam) ---
// The Observer interface is the product: implement it for Splunk / New Relic / OTel / etc.
// `consoleObserver` is the batteries-included default. `instrument`/`track` are internal.
export { consoleObserver } from "./observer/observer.console";
export type { ConsoleObserverOptions } from "./observer/observer.console";
export type {
  Observer,
  Logger,
  ErrorReport,
  HookEvent,
  HookPre,
  HookProgress,
  HookSuccess,
  HookFailure,
  ObservedOp,
  ObserverPhase,
  ObserverLevel,
  ObserverData,
} from "./observer/observer.interface";
