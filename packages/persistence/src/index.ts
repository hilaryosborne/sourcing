// Public API surface for @hilaryosborne/sourcing-persistence — the repository. The barrel IS
// the public API (interface-adapters §"Barrels are the public API"): what is exported here is
// the contract; anything not exported is internal.
//
// Four artefacts make up this surface:
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

// --- Cross-stream read models (the firehose: fold MANY streams into one view) ---
// A read model is a pure cross-stream fold; the feed is an OPTIONAL adapter capability (global
// ordering, kept off the shared StorageI port); the processor is the resumable catch-up wire.
// Design + open questions: docs/internal/design/cross-stream-read-models.md.
export { readModel } from "./read-model/read-model";
export type { ReadModelDefinition, ReadModelHandler } from "./read-model/read-model";
export { ReadModelErrors } from "./read-model/read-model.errors";
export { StoredReadModelV1 } from "./read-model/read-model.model";
export type { StoredReadModelV1Type } from "./read-model/read-model.model";
export type { ReadModelStoreI } from "./read-model/read-model.store";
export type { StorageFeedI, FeedEntry, FeedPage, FeedCursor } from "./feed/feed";
export { processor } from "./processor/processor";
export type { ProcessorI, ProcessorDeps, CatchUpOptions } from "./processor/processor";
