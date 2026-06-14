// The aggregate — the AGGREGATE. A faithful container for one id's event stream. It holds
// events, keeps committed apart from staged, and reports its position. It does NOT
// fetch, store, orchestrate, or judge (FOUNDATION §Aggregates). Two levels:
// definition (name + legal events) and instance (an id + the stream).
import type { EventDefinition } from "../event/event";
import type { EventInstance } from "../event/event.instance";
import type { EventEnvelopeV1Type } from "../event/event.schema";
import type { StageDsl } from "./aggregate.stage";
import { stage } from "./aggregate.stage";
import { AggregateErrors } from "./aggregate.errors";

// The aggregate's mutable working state: the committed/staged split. Mutated in place as a
// builder (style "Immutability"); reads hand out copies, strip() forks a new aggregate.
export interface AggregateState {
  committed: EventInstance[];
  staged: EventInstance[];
}

// A registered event, with its payload type erased — the heterogeneous list an
// aggregate holds. The registry only ever needs topic (to look up / detect collisions)
// and restore (to rehydrate imported history); the payload-typed create()/strip() are
// reached through the caller's own typed definition at add()-time, never through here.
// Erasing the contravariant members is what lets EventDefinition<anyPayload> live in
// one list — EventInstance is covariant in its payload, so restore stays assignable.
export interface RegisteredEvent {
  topic: string;
  restore: (envelope: EventEnvelopeV1Type) => EventInstance;
}

// An aggregate INSTANCE: an id plus the committed/staged split. The split is
// load-bearing — it is how a consuming app previews "what would the state be?"
// without the core ever knowing what validation is.
export interface AggregateInstance {
  get: {
    id: () => string;
    name: () => string;
    // The durable history (already persisted) vs the proposed-not-yet-committed set.
    committed: () => EventInstance[];
    staged: () => EventInstance[];
    // committed ++ staged, in position order — the event set you fold to preview the
    // would-be state (the Scenario 3 overlay). Pass this to projection.build().
    events: () => EventInstance[];
    // Head index in the aggregate: the highest position it can see, or undefined if empty.
    position: () => number | undefined;
  };
  // Load durable history into `committed` (the repository fills the aggregate). Rehydrates each
  // envelope via its definition; an unregistered topic throws TOPIC_UNKNOWN, a
  // malformed envelope throws EVENT_INVALID.
  import: (events: EventEnvelopeV1Type[]) => AggregateInstance;
  // Begin staging a new fact. `definition` must be registered on the aggregate
  // definition, else AggregateErrors.TOPIC_UNKNOWN. Returns the staging dsl.
  add: <P>(definition: EventDefinition<P>) => StageDsl<P>;
  // In-memory bookkeeping only: fold `staged` into `committed`. Models the aggregate AFTER
  // the repository has persisted the staged events. Stores nothing — core has no storage.
  commit: () => AggregateInstance;
  // Right-to-forget at the aggregate level: walk committed + staged and apply the named
  // stripper to each event whose definition has one, returning a NEW aggregate with
  // redacted events. Identity preserved per event; nothing mutated in place; no
  // marker appended. The pass/fail test: no PII survives in the produced events.
  strip: (context: string) => AggregateInstance;
  // Expose the aggregate's events (committed ++ staged) as plain validated envelopes.
  export: () => EventEnvelopeV1Type[];
}

// An aggregate DEFINITION: a name + the event types legal on it. Construction is
// where per-aggregate topic uniqueness bites (duplicate topic → TOPIC_DUPLICATE).
export interface AggregateDefinition {
  name: string;
  events: RegisteredEvent[];
  // Look up a registered event by topic (used by staging + import).
  topic: (topic: string) => RegisteredEvent | undefined;
  // Mint a fresh, empty aggregate for one aggregate id.
  instance: (id: string) => AggregateInstance;
}

const aggregateInstance = (definition: AggregateDefinition, id: string, state: AggregateState): AggregateInstance => {
  const all = () => [...state.committed, ...state.staged];
  const instance: AggregateInstance = {
    get: {
      id: () => id,
      name: () => definition.name,
      committed: () => [...state.committed],
      staged: () => [...state.staged],
      events: () => all(),
      position: () => {
        const positions = all()
          .map((event) => event.get.position())
          .filter((position): position is number => position !== undefined);
        return positions.length ? Math.max(...positions) : undefined;
      },
    },
    import: (events) => {
      for (const envelope of events) {
        const eventDefinition = definition.topic(envelope.topic);
        if (!eventDefinition) throw new Error(AggregateErrors.TOPIC_UNKNOWN);
        try {
          state.committed.push(eventDefinition.restore(envelope));
        } catch (cause) {
          throw new Error(AggregateErrors.EVENT_INVALID, { cause });
        }
      }
      return instance;
    },
    add: (eventDefinition) => {
      if (!definition.topic(eventDefinition.topic)) throw new Error(AggregateErrors.TOPIC_UNKNOWN);
      return stage(definition.name, instance, state, eventDefinition);
    },
    commit: () => {
      state.committed = [...state.committed, ...state.staged];
      state.staged = [];
      return instance;
    },
    strip: (context) =>
      aggregateInstance(definition, id, {
        committed: state.committed.map((event) => event.strip(context)),
        staged: state.staged.map((event) => event.strip(context)),
      }),
    export: () => all().map((event) => event.build()),
  };
  return instance;
};

// aggregate("file", [FileCreateV1, FileRenameV1])
const aggregate = (name: string, events: RegisteredEvent[]): AggregateDefinition => {
  const byTopic = new Map<string, RegisteredEvent>();
  for (const eventDefinition of events) {
    if (byTopic.has(eventDefinition.topic)) throw new Error(AggregateErrors.TOPIC_DUPLICATE);
    byTopic.set(eventDefinition.topic, eventDefinition);
  }
  const definition: AggregateDefinition = {
    name,
    events,
    topic: (topic) => byTopic.get(topic),
    instance: (id) => aggregateInstance(definition, id, { committed: [], staged: [] }),
  };
  return definition;
};

export default aggregate;
