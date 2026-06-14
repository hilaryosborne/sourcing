// DRAFT — Epic 4, Phase A (redraft). THE AGGREGATE REGISTRY — the "aggregate id → current
// head position" lookup of FOUNDATION §Scenario 2. A persistence-layer concept (core never
// says the word "registry", §"The B ruling"), so it lives here, not in core. Awaiting
// per-artefact ratification (DRAFT-AND-HALT.md).
//
// The registry is NOT a separately-written store. The head IS a property of the event
// stream, so the registry is just `storage.head()` behind a named contract — one cheap
// read, maintained by the adapter as a side effect of append(). Its whole VALUE is that it
// is cheap: one lookup tells self-healing whether a stored projection is current without
// fetching a single event. A full-stream scan here would buy nothing.
//
// Functional, not a class: this composes a storage adapter we own and wire ourselves — the
// Mode-A construction style, not a swappable published contract.
import type { StorageEventsI } from "../storage/storage.interface";
import type { StorageStream } from "../storage/storage.model";

export interface RegistryI {
  // The current head position of a stream, or undefined if the stream is unknown/empty.
  head(stream: StorageStream): Promise<number | undefined>;
}

// registry(storage) — wrap a storage adapter's cheap head read as the named registry. The
// repository auto-wires this from its one storage adapter; exposed standalone for testing
// and advanced composition.
export const registry = (storage: StorageEventsI): RegistryI => {
  void storage;
  throw new Error("not implemented — awaiting ratification");
};

export default registry;
