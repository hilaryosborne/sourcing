// DRAFT — Epic 4, Phase A (redraft). THE REPOSITORY — where core's pure aggregate +
// projection builder are COMPOSED with a storage adapter. It owns the write path (create /
// load / commit), the self-healing read path (rebuild), and right-to-forget (forget). It
// depends on core; core never depends on it (FOUNDATION §"The B ruling"). The same core
// aggregate + projection serve Scenario 1 (consumer fills the aggregate) and Scenario 2
// (the repository fills it) — the repository cannot tell which scenario core is in, and
// that is the point. Signatures + described steps; awaiting per-artefact ratification.
import type { AggregateDefinition, AggregateInstance, ProjectionDefinition } from "@hilaryosborne/sourcing";
import type { StorageI } from "../storage/storage.interface";

// The repository composes ONE storage adapter; it derives the registry and projection store
// from that adapter itself (‹DRAFT — auto-wiring, storage-session item›: the consumer wires
// only `storage`). The standalone registry()/projectionStore() factories remain for testing.
export interface RepositoryDeps {
  storage: StorageI;
}

// What rebuild needs to heal one projection of one aggregate instance. The projection's
// store key is its OWN name (ProjectionDefinition.name) — no separate `name` field.
export interface RebuildInput<State> {
  aggregate: AggregateDefinition;
  id: string;
  projection: ProjectionDefinition<State>;
}

// What forget needs to erase one aggregate instance in one context.
export interface ForgetInput {
  aggregate: AggregateDefinition;
  id: string;
  context: string;
}

export interface RepositoryI {
  // --- Write path ---------------------------------------------------------------------

  // Mint a fresh, empty aggregate instance ready to be filled and committed. The id is
  // core-minted by default (a nanoid via definition.instance()); a storage adapter MAY
  // override id generation, but core-minting is the default (FOUNDATION §Aggregates). Async
  // to leave room for an adapter that reserves/derives ids in storage.
  create(definition: AggregateDefinition): Promise<AggregateInstance>;

  // Hydrate an existing aggregate: read its full stream from storage and import it into a
  // fresh instance's `committed`, returning the instance ready for further staging.
  load(definition: AggregateDefinition, id: string): Promise<AggregateInstance>;

  // Persist an aggregate's STAGED events and advance the head, then fold staged → committed
  // in memory and return the instance. Steps:
  //   1. take the staged envelopes (aggregate.events.staged.map(build))
  //   2. storage.append(stream, staged, expectedHead?)   (expectedHead = THIS adapter's head
  //      before the staged events; VERSION_CONFLICT on mismatch — a per-adapter head, never
  //      a global one; see StorageEventsI.append)
  //   3. aggregate.events.commit()  (in-memory: staged → committed)
  commit(aggregate: AggregateInstance): Promise<AggregateInstance>;

  // --- Read path (self-healing) -------------------------------------------------------

  // Return the up-to-date projected state for (id, projection.name), healing the stored
  // projection as a side effect. The three outcomes (FOUNDATION §Scenario 2):
  //
  //   1. load the stored projection for (stream, projection.name) → its bookmark, or none
  //   2. ask the registry for the stream's current head           → one cheap read
  //   3. decide:
  //        • no stored projection      → read the FULL stream, import into a fresh
  //          aggregate, projection.build(aggregate), save {state, bookmark = head}
  //        • head  >  bookmark (stale)  → read ONLY the delta (events after bookmark),
  //          import into a fresh aggregate, projection.build(aggregate, storedState) —
  //          the seeded fold folds the delta over the stored state — save {state, head}
  //        • head === bookmark (current) → return stored state as-is, NO event fetch
  //
  // The stale path is exactly why core's build takes a starting state: storedState (lifted
  // from `unknown` via projection.schema) seeds the fold so only the delta is replayed.
  rebuild<State>(input: RebuildInput<State>): Promise<State>;

  // --- Right-to-forget ----------------------------------------------------------------

  // Erase one aggregate instance in one context. Steps (the repository owns the ordering so
  // a consumer cannot skip a step and leave PII behind):
  //   1. load the FULL stream into an aggregate
  //   2. aggregate.strip(context)            (core: redact each event whose def has a stripper)
  //   3. storage.overwrite(stream, redacted) (overwrite events in place; the source of truth
  //      is now PII-free)
  //   4. projectionStore.delete(stream)      (bin EVERY projection for the stream)
  //
  // Step 4 is load-bearing and easy to forget: overwrite does NOT move the head, so a
  // "current" projection (head === bookmark) would be served from cache and still contain
  // PII. Binning forces the next rebuild down the clean full-build path. The app owns the
  // DECISION to forget; the repository owns the MECHANISM — no business judgement moves into
  // the library, only the know-how to erase correctly.
  //
  // ⚠ forget LEAVES THE READ SIDE EMPTY until the next rebuild. Binning is correct for
  // compliance (no PII is ever served), but there is NO clean projection sitting in storage
  // the instant forget() returns — a consumer expecting one will find nothing until it calls
  // rebuild(), which then does the clean full build. Erase first; rebuild on read.
  //
  // RESOLVED (storage session): overwrite's match key is (stream, position); projection
  // bin-all is an ADAPTER CAPABILITY — the repository DELEGATES to projectionStore.delete →
  // storage.deleteProjections, never a repository-level prefix scan. forget assumes only
  // "this adapter's head" and "this adapter's cleanup" — nothing global (FOUNDATION
  // §"Single adapter per repository").
  forget(input: ForgetInput): Promise<void>;
}

// repository({ storage }) — compose a storage adapter into the repository (deriving the
// registry + projection store from it).
export const repository = (deps: RepositoryDeps): RepositoryI => {
  void deps;
  throw new Error("not implemented — awaiting ratification");
};

export default repository;
