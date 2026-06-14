// The aggregate — a faithful container for one id's event stream (contracts A + D,
// ratified). It holds events, keeps committed apart from staged, and reports its position.
// It does NOT fetch, store, orchestrate, or judge (FOUNDATION §Aggregates).
//
// Two levels: definition (name + the events registered legal on it) and instance (an id +
// the stream). Construction is imperative — `aggregate(name)` then `.register(event)` per
// event. Identity is exposed as plain properties; all event operations live under `.events`.
import { nanoid } from "nanoid";
import type { EventDefinition } from "../event/event";
import type { EventInstance } from "../event/event.instance";
import type { EventEnvelopeV1Type } from "../event/event.schema";
import { AggregateErrors } from "./aggregate.errors";

// A registered event, payload type erased — the heterogeneous list an aggregate holds.
// The definition only ever needs topic (to look up / detect collisions) and restore (to
// rehydrate imported history); the payload-typed create() is reached through the caller's
// own typed definition at add()-time, never through here.
export interface RegisteredEvent {
  topic: string;
  restore: (envelope: EventEnvelopeV1Type) => EventInstance;
}

// All event operations on an instance, grouped under `instance.events`.
export interface AggregateEvents {
  // The two event sets: the durable history vs. the proposed-not-yet-committed set.
  committed: EventInstance[];
  staged: EventInstance[];
  // Add a standalone event (from `EventDef.create(payload).creator(...)`) to the stream.
  // Verifies the topic is registered on this aggregate (else TOPIC_UNKNOWN) and that
  // provenance is present (else MISSING_CREATOR), stamps the provisional position +
  // aggregate reference, stages it, and returns the staged instance.
  add: <P>(event: EventInstance<P>) => EventInstance<P>;
  // Load durable history into `committed`. Rehydrates each envelope via its definition;
  // an unregistered topic throws TOPIC_UNKNOWN, a malformed envelope throws EVENT_INVALID.
  import: (events: EventEnvelopeV1Type[]) => AggregateInstance;
  // committed ++ staged, in position order, as plain validated envelopes.
  export: () => EventEnvelopeV1Type[];
  // In-memory bookkeeping only: fold `staged` into `committed`. Models the stream AFTER
  // the repository has persisted the staged events. Stores nothing — core has no storage.
  commit: () => AggregateInstance;
}

// An aggregate INSTANCE: an id, its name, its position, and its events. The committed/
// staged split is load-bearing — it is how a consuming app previews "what would the state
// be?" without core ever knowing what validation is.
export interface AggregateInstance {
  id: string;
  name: string;
  // Head index in the stream: the highest position across committed ++ staged, or
  // undefined if empty.
  position: number | undefined;
  events: AggregateEvents;
  // Right-to-forget at the aggregate level: walk committed + staged and apply the named
  // stripper to each event whose definition has one, returning a NEW aggregate with
  // redacted events. Identity preserved per event; nothing mutated in place; no marker
  // appended. The pass/fail test: no PII survives in the produced events.
  strip: (context: string) => AggregateInstance;
}

// An aggregate DEFINITION: a name + the event types legal on it. `register()` is where
// per-aggregate topic uniqueness bites (duplicate topic → TOPIC_DUPLICATE).
export interface AggregateDefinition {
  name: string;
  events: RegisteredEvent[];
  // Look up a registered event by topic (used by add() + import()).
  topic: (topic: string) => RegisteredEvent | undefined;
  // Mint an instance. `id` is OPTIONAL — core generates an identifier (a nanoid, exactly
  // as an event's id is minted) when it is omitted, so an aggregate is identifiable without
  // any storage (FOUNDATION §Aggregates). An explicit id is accepted; a storage adapter
  // may override id generation, but core-minting is the default.
  instance: (id?: string) => AggregateInstance;
  // Register an event definition as legal on this aggregate. Chainable. Duplicate topic
  // on one definition → AggregateErrors.TOPIC_DUPLICATE.
  register: <P>(definition: EventDefinition<P>) => AggregateDefinition;
}

// The instance's mutable working state: the committed/staged split, mutated in place as a
// builder; reads hand out copies, strip() forks a new instance.
interface AggregateState {
  committed: EventInstance[];
  staged: EventInstance[];
}

// The next provisional position: one past the highest the stream can see, 0 for empty.
// Two processes staging onto separately-loaded copies will both pick the same index —
// reconciling that is the repository's job, not core's (FOUNDATION §Events).
const nextPosition = (state: AggregateState): number => {
  const positions = [...state.committed, ...state.staged]
    .map((event) => event.get.position())
    .filter((position): position is number => position !== undefined);
  return positions.length ? Math.max(...positions) + 1 : 0;
};

const aggregateInstance = (definition: AggregateDefinition, id: string, state: AggregateState): AggregateInstance => {
  const all = () => [...state.committed, ...state.staged];
  const instance: AggregateInstance = {
    id,
    name: definition.name,
    get position() {
      const positions = all()
        .map((event) => event.get.position())
        .filter((position): position is number => position !== undefined);
      return positions.length ? Math.max(...positions) : undefined;
    },
    events: {
      get committed() {
        return [...state.committed];
      },
      get staged() {
        return [...state.staged];
      },
      add: (event) => {
        if (!definition.topic(event.get.topic())) throw new Error(AggregateErrors.TOPIC_UNKNOWN);
        if (!event.get.creator()) throw new Error(AggregateErrors.MISSING_CREATOR);
        const staged = event.stage({ id, name: definition.name }, nextPosition(state));
        state.staged.push(staged as EventInstance);
        return staged;
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
      export: () => all().map((event) => event.build()),
      commit: () => {
        state.committed = [...state.committed, ...state.staged];
        state.staged = [];
        return instance;
      },
    },
    strip: (context) =>
      aggregateInstance(definition, id, {
        committed: state.committed.map((event) => event.strip(context)),
        staged: state.staged.map((event) => event.strip(context)),
      }),
  };
  return instance;
};

// aggregate("file.v1") then .register(FileCreateV1).register(FileRenameV1)
const aggregate = (name: string): AggregateDefinition => {
  const byTopic = new Map<string, RegisteredEvent>();
  const events: RegisteredEvent[] = [];
  const definition: AggregateDefinition = {
    name,
    events,
    topic: (topic) => byTopic.get(topic),
    instance: (id) => aggregateInstance(definition, id ?? nanoid(), { committed: [], staged: [] }),
    register: (eventDefinition) => {
      if (byTopic.has(eventDefinition.topic)) throw new Error(AggregateErrors.TOPIC_DUPLICATE);
      const registered: RegisteredEvent = { topic: eventDefinition.topic, restore: eventDefinition.restore };
      byTopic.set(registered.topic, registered);
      events.push(registered);
      return definition;
    },
  };
  return definition;
};

export default aggregate;
