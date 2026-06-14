// DRAFT — Epic 4, Phase A (redraft). THE PROJECTION STORE — load / save / delete a
// projection with its bookmark (FOUNDATION §Scenario 2). A persistence-layer contract
// composed on top of a storage adapter; core has no stored-projection concept. Awaiting
// per-artefact ratification (DRAFT-AND-HALT.md).
//
// A thin, intention-revealing wrapper over StorageProjectionsI: the store speaks in
// (stream, name) and StoredProjection; the self-healing algorithm speaks to the store.
// Functional (the Mode-A construction style — we own and wire it).
import type { StorageProjectionsI } from "../storage/storage.interface";
import type { StorageStream, StoredProjectionV1Type } from "../storage/storage.model";

export interface ProjectionStoreI {
  // The stored projection for (stream, name), or undefined if never built. Undefined is the
  // signal for the "build from scratch" outcome of self-healing.
  load(stream: StorageStream, name: string): Promise<StoredProjectionV1Type | undefined>;

  // Persist state + bookmark, overwriting any prior projection for the same (aggregate,
  // name). The bookmark (`position`) is what the next self-heal compares to the registry
  // head; it travels WITH the state, never separately, so the cheap path can't be corrupted.
  save(stored: StoredProjectionV1Type): Promise<void>;

  // Bin EVERY projection for a stream — what right-to-forget calls after overwriting events,
  // so a "current" cached projection cannot mask the erasure (the next rebuild does a clean
  // full build from the redacted events).
  delete(stream: StorageStream): Promise<void>;
}

// projectionStore(storage) — bind a storage adapter as the projection store. The repository
// auto-wires this from its one storage adapter; exposed standalone for testing.
export const projectionStore = (storage: StorageProjectionsI): ProjectionStoreI => {
  void storage;
  throw new Error("not implemented — awaiting ratification");
};

export default projectionStore;
