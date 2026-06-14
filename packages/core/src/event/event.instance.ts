// A single event instance: live state + the dsl that reads, stages, strips and
// builds it. Functional mode (coding-style §5 / functional-dsl) — a closure over a
// `data` object, NOT a class. Reads under `get`, staging writes under `set`, terminal
// `build()` validates at the boundary.
import { nanoid } from "nanoid";
import type { ZodType } from "zod";
import { EventEnvelopeV1 } from "./event.schema";
import type { AggregateRefV1Type, CreatorSchemaV1Type, EventEnvelopeV1Type } from "./event.schema";
import type { Stripper } from "./event";

// The instance dsl. Generic over the payload type the definition's schema infers.
// Returns of mutating accessors are the dsl itself so staging reads as a story.
export interface EventInstance<P = unknown> {
  get: {
    id: () => string;
    topic: () => string;
    payload: () => P;
    created: () => string;
    // Staging fields — undefined until the event is staged onto an aggregate.
    position: () => number | undefined;
    aggregate: () => AggregateRefV1Type | undefined;
    creator: () => CreatorSchemaV1Type | undefined;
    headers: () => Record<string, unknown>;
  };
  // The staging seam: the aggregate calls these to assign the provisional position,
  // the aggregate reference, and the required creator as an event is staged.
  set: {
    position: (position: number) => EventInstance<P>;
    aggregate: (ref: AggregateRefV1Type) => EventInstance<P>;
    creator: (creator: CreatorSchemaV1Type) => EventInstance<P>;
    headers: (headers: Record<string, unknown>) => EventInstance<P>;
  };
  // Right-to-forget. Applies the named stripper from this event's definition and
  // returns a NEW instance preserving identity (same id/position/topic/aggregate/
  // creator/headers/created) with a redacted payload. No matching stripper → a
  // new instance with the payload unchanged (a no-op), so an aggregate can strip
  // every event uniformly. Pure; nothing is mutated in place (FOUNDATION §Strippers).
  strip: (context: string) => EventInstance<P>;
  // Validates the envelope AND the payload (against the definition's schema), then
  // yields the finished fact. Throws if called before staging — an unstaged event
  // has no position/aggregate/creator and cannot form a full envelope.
  build: () => EventEnvelopeV1Type;
}

// The instance's mutable working state. The ONE sanctioned place to mutate (style
// "Immutability") — internal builder state, copied on the way out via build()/strip().
interface EventData<P> {
  id: string;
  topic: string;
  payload: P;
  created: string;
  headers: Record<string, unknown>;
  position?: number;
  aggregate?: AggregateRefV1Type;
  creator?: CreatorSchemaV1Type;
}

// The shared dsl assembly. Both fresh creation and envelope rehydration funnel here,
// differing only in how `data` is seeded — so identity handling lives in one place.
const make = <P>(schema: ZodType<P>, strippers: Map<string, Stripper<P>>, data: EventData<P>): EventInstance<P> => {
  const dsl: EventInstance<P> = {
    get: {
      id: () => data.id,
      topic: () => data.topic,
      payload: () => data.payload,
      created: () => data.created,
      position: () => data.position,
      aggregate: () => data.aggregate,
      creator: () => data.creator,
      headers: () => data.headers,
    },
    set: {
      position: (position) => ((data.position = position), dsl),
      aggregate: (ref) => ((data.aggregate = ref), dsl),
      creator: (creator) => ((data.creator = creator), dsl),
      headers: (headers) => ((data.headers = headers), dsl),
    },
    strip: (context) => {
      const stripper = strippers.get(context);
      const payload = stripper ? stripper(data.payload) : data.payload;
      // New instance, same identity/metadata, redacted payload. Never mutate in place.
      return make(schema, strippers, { ...data, payload });
    },
    // Validate payload against the definition schema, then the whole envelope. An
    // unstaged event fails here (position/aggregate/creator absent) — by design.
    build: () => EventEnvelopeV1.parse({ ...data, payload: schema.parse(data.payload) }),
  };
  return dsl;
};

// Fresh creation: mint id + created eagerly (captured as facts, never replayed);
// staging fields stay unset until the aggregate assigns them.
export const eventInstance = <P>(
  topic: string,
  schema: ZodType<P>,
  strippers: Map<string, Stripper<P>>,
  payload: P,
): EventInstance<P> =>
  make(schema, strippers, { id: nanoid(), topic, payload, created: new Date().toISOString(), headers: {} });

// Rehydration from a complete, already-persisted envelope — the internal constructor
// behind EventDefinition.restore(). Mints NO new id/created: it carries the stored
// identity and metadata through, re-validating both envelope and payload. The shared
// `strippers` map means a rehydrated committed event is still strippable.
export const eventInstanceFromEnvelope = <P>(
  schema: ZodType<P>,
  strippers: Map<string, Stripper<P>>,
  envelope: EventEnvelopeV1Type,
): EventInstance<P> => {
  const parsed = EventEnvelopeV1.parse(envelope);
  return make(schema, strippers, {
    id: parsed.id,
    topic: parsed.topic,
    payload: schema.parse(parsed.payload),
    created: parsed.created,
    headers: parsed.headers,
    position: parsed.position,
    aggregate: parsed.aggregate,
    creator: parsed.creator,
  });
};
