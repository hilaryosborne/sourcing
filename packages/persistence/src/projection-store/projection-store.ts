// THE PROJECTION STORE — load / save / delete a projection with its bookmark (FOUNDATION
// §Scenario 2). A persistence-layer contract composed on top of a storage adapter; core has
// no stored-projection concept.
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
// auto-wires this from its one storage adapter; exposed standalone for testing. A thin,
// intention-revealing wrapper: it speaks (stream, name) + StoredProjection and DELEGATES to
// the adapter capabilities — it bakes in no storage strategy of its own.
export const projectionStore = (storage: StorageProjectionsI): ProjectionStoreI => ({
  load: (stream, name) => storage.loadProjection(stream, name),
  save: (stored) => storage.saveProjection(stored),
  // The seam forget's bin-all delegates to: cleanup is the ADAPTER's capability ("remove
  // every projection for this stream"), fulfilled however the backend must (our adapters
  // delete by prefix; a consumer who spreads projections supplies their own cleanup behind
  // the same seam). NO prefix scan or colocation assumption is baked in at THIS layer
  // (FOUNDATION §"Single adapter per repository").
  delete: (stream) => storage.deleteProjections(stream),
});

export default projectionStore;
