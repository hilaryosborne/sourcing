// DRAFT — Epic 4, Phase B (implementation). THE REPOSITORY — where core's pure aggregate +
// projection builder are COMPOSED with a storage adapter. It owns the write path (create /
// load / commit), the self-healing read path (rebuild), and right-to-forget (forget). It
// depends on core; core never depends on it (FOUNDATION §"The B ruling"). The same core
// aggregate + projection serve Scenario 1 (consumer fills the aggregate) and Scenario 2
// (the repository fills it) — the repository cannot tell which scenario core is in, and
// that is the point.
//
// Sub-artefact draft-and-halt (3a/3b/3c): the WRITE PATH (create/load/commit) is implemented
// here; `rebuild` (three-outcome, slowed-down ruling) and `forget` (correctness, slowed-down
// ruling) remain stubbed, each awaiting its OWN ratification — they are NOT batched.
import type {
  AggregateDefinition,
  AggregateInstance,
  EventEnvelopeV1Type,
  ProjectionDefinition,
} from "@hilaryosborne/sourcing";
import type { StorageI } from "../storage/storage.interface";
import type { StorageStream } from "../storage/storage.model";
import type { Observer } from "../observer/observer.interface";
import { registry } from "../registry/registry";
import { projectionStore } from "../projection-store/projection-store";
import { instrument, step, track } from "../observer/observe";
import { RepositoryErrors } from "./repository.errors";

// The repository composes ONE storage adapter; it derives the registry and projection store
// from that adapter itself (‹DRAFT — auto-wiring, storage-session item›: the consumer wires
// only `storage`). The standalone registry()/projectionStore() factories remain for testing.
//
// `observer` is OPTIONAL observability (logging / error-reporting / profiling). When supplied,
// the repository traces its 5 operations AND wraps the storage adapter so every port call is
// observed at the same boundary — adapters stay non-invasive. When omitted, nothing is wrapped
// and nothing is emitted (the quiet default costs nothing). See observer/observer.interface.ts.
export interface RepositoryDeps {
  storage: StorageI;
  observer?: Observer;
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

// The stream key for an aggregate: its core reference (id + definition name). Storage keys
// everything by this; we never invent a stream identity.
const streamOf = (id: string, name: string): StorageStream => ({ id, name });

// The head an aggregate was loaded at: the highest COMMITTED position (before any staging),
// or undefined if it holds no committed history. This is the optimistic-concurrency guard
// passed to append — THIS adapter's expected head, never a global one.
const committedHead = (aggregate: AggregateInstance): number | undefined => {
  const positions = aggregate.events.committed
    .map((event) => event.get.position())
    .filter((position): position is number => position !== undefined);
  return positions.length ? Math.max(...positions) : undefined;
};

// repository({ storage }) — compose a storage adapter into the repository, deriving the
// registry + projection store from it (the consumer wires only `storage`).
export const repository = (deps: RepositoryDeps): RepositoryI => {
  const { observer } = deps;
  // When an observer is wired, work through an INSTRUMENTED view of the adapter so every port
  // call — including the registry's head read and the projection store's load/save/delete — is
  // observed at this one boundary. No observer → the raw adapter, no wrapping, no overhead.
  const storage = observer ? instrument(deps.storage, observer) : deps.storage;
  // Auto-wired collaborators (the ratified registry + projectionStore, bound to this one
  // adapter). Held for the read path + forget; the write path talks to storage directly.
  const reg = registry(storage);
  const projections = projectionStore(storage);

  const repo: RepositoryI = {
    // --- Write path (3a) ---------------------------------------------------------------

    // Mint a fresh, empty aggregate. The id is core-minted (definition.instance() → nanoid);
    // async leaves room for an adapter that derives/reserves ids, but the default touches no
    // storage. Nothing is persisted until commit().
    create: (definition) =>
      track(
        observer,
        "create",
        undefined,
        async () => definition.instance(),
        (instance) => ({
          stream: instance.id,
          aggregate: instance.name,
        }),
      ),

    // Hydrate an existing aggregate: read its full stream and import it into a fresh
    // instance's `committed`, returning it ready for further staging.
    load: (definition, id) =>
      track(observer, "load", streamOf(id, definition.name), async () => {
        const instance = definition.instance(id);
        const events = await storage.read(streamOf(id, definition.name));
        instance.events.import(events);
        return instance;
      }),

    // Persist the aggregate's STAGED events and advance the head, then fold staged →
    // committed in memory and return the instance. A no-op for an aggregate with nothing
    // staged. `expectedHead` is the loaded committed head — VERSION_CONFLICT on mismatch
    // (optimistic concurrency against THIS adapter's head).
    commit: (aggregate) =>
      track(observer, "commit", streamOf(aggregate.id, aggregate.name), async () => {
        const staged = aggregate.events.staged;
        if (staged.length === 0) return aggregate;
        const stream = streamOf(aggregate.id, aggregate.name);
        const envelopes: EventEnvelopeV1Type[] = staged.map((event) => event.build());
        await storage.append(stream, envelopes, committedHead(aggregate));
        aggregate.events.commit();
        return aggregate;
      }),

    // --- Read path (3b): self-healing rebuild, the three-outcome logic ------------------
    rebuild: (input) =>
      track(observer, "rebuild", streamOf(input.id, input.aggregate.name), async () => {
        const { aggregate, id, projection } = input;
        const stream = streamOf(id, aggregate.name);

        // Step 1 — load the stored projection (carries its bookmark), or none.
        const stored = await projections.load(stream, projection.name);
        // Step 2 — ONE cheap registry read for the stream's current head.
        const head = await reg.head(stream);

        // Corruption guard — NOT one of the three outcomes. A stored bookmark at or past a head
        // the stream cannot reach means the projection claims to have folded events that do not
        // exist (head behind bookmark, or no head at all under a stored projection). Refuse,
        // rather than silently rebuild over a corrupt bookmark (FOUNDATION §"Forget is not
        // atomic" records the related convergence obligation).
        if (stored && (head === undefined || head < stored.position)) {
          throw new Error(RepositoryErrors.PROJECTION_AHEAD_OF_HEAD);
        }

        // Outcome CURRENT — head === bookmark: nothing new since the projection was built.
        // Return the stored state as-is, lifted from `unknown` via the projection's own schema.
        // NO event fetch — the cheap win. The progress step is the cache-hit signal.
        if (stored && head === stored.position) {
          step(observer, "rebuild", stream, "current");
          return projection.schema.parse(stored.state);
        }

        // Outcomes NO-STORED (full build) and STALE (delta fold) share ONE core build — the
        // only differences are the read window and whether there is a seed:
        //   • NO-STORED → read the FULL stream (after = undefined), no seed → fold from the
        //     first event.
        //   • STALE     → read ONLY the delta (after = bookmark), seed = stored state → the
        //     seeded fold applies the delta on top of the stored state.
        // Core cannot tell which outcome it is serving: it is the SAME aggregate.instance +
        // projection.build in both — Scenario 1 (consumer-filled) and Scenario 2 (repository-
        // filled) are indistinguishable to core. The only difference is who filled the
        // aggregate. That is the B-ruling proof, made concrete.
        step(observer, "rebuild", stream, stored ? "stale" : "no_stored");
        const seed = stored ? projection.schema.parse(stored.state) : undefined;
        const events = await storage.read(stream, stored?.position);
        const instance = aggregate.instance(id);
        instance.events.import(events);
        const state = projection.build(instance, seed);

        // Bookmark = the head we actually folded up to (the imported events' max position).
        // A successful build means ≥1 event folded, so this is defined; the `?? 0` branch is
        // unreachable (an empty fold fails the projection's shape validation first).
        const bookmark = instance.position ?? 0;
        await projections.save({ aggregate: stream, name: projection.name, position: bookmark, state });
        return state;
      }),

    // --- Right-to-forget (3c): erasure with end-to-end correctness ----------------------
    forget: (input) =>
      track(observer, "forget", streamOf(input.id, input.aggregate.name), async () => {
        const { aggregate, id, context } = input;
        const stream = streamOf(id, aggregate.name);

        // 1. Load the FULL stream into an aggregate.
        const instance = aggregate.instance(id);
        instance.events.import(await storage.read(stream));
        step(observer, "forget", stream, "loaded");

        // 2. strip(context) — core forks a NEW aggregate with redacted events: same id /
        //    position / topic / metadata, redacted payload, nothing mutated in place. Core
        //    produces the stripped events; it does NOT persist them (that is this layer's job).
        const redacted = instance.strip(context);
        step(observer, "forget", stream, "stripped");

        // 3. Overwrite the events in place — keyed (stream, position), the one sanctioned
        //    exception to append-only. The source of truth is now PII-free.
        await storage.overwrite(stream, redacted.events.export());
        step(observer, "forget", stream, "overwritten");

        // 4. Bin EVERY projection for the stream — the DELEGATED adapter capability (not a
        //    repository-level prefix scan). Because overwrite does not move the head, a
        //    "current" projection would otherwise be served from cache and mask the erasure;
        //    binning forces the next rebuild down the clean full-build path. Lazy heal: the
        //    read side is left EMPTY until the next rebuild rebuilds it from the redacted events.
        await projections.delete(stream);
        step(observer, "forget", stream, "binned");
      }),
  };
  return repo;
};

export default repository;
