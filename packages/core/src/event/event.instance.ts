// The event instance — a STANDALONE, fluent builder (contract C, ratified). It is what
// `EventDef.create(payload)` returns: the consumer decorates it with `.creator()` /
// `.headers()`, then an aggregate stamps its position + reference via `stage()` when it is
// added (FOUNDATION §Events; DOCS.md "standalone events"). The same instance type covers an
// unstaged event (no position/aggregate yet), a staged event, and a rehydrated committed
// event — they differ only in which fields are set.
//
// Functional mode (coding-style §5 / functional-dsl) — a closure over a `data` object,
// not a class. Reads under `get`, the staging seam is `stage()`, terminal `build()`
// validates at the boundary.
import { nanoid } from "nanoid";
import type { ZodType } from "zod";
import { EventEnvelopeV1 } from "./event.schema";
import type { AggregateRefV1Type, CreatorSchemaV1Type, EventEnvelopeV1Type } from "./event.schema";
import type { Stripper } from "./event";

// A standalone event instance. Built by EventDefinition.create(), decorated fluently,
// then handed to aggregate.events.add() which stages it.
export interface EventInstance<P = unknown> {
  // --- Consumer-facing fluent builders (pre-staging) ---
  // Provenance. REQUIRED before the event can be added to an aggregate — a missing
  // creator fails loudly at add() (no default; FOUNDATION §Events). Positional (entity,
  // uid) for ergonomics; stored as the CreatorSchemaV1 value object.
  creator: (entity: string, uid: string) => EventInstance<P>;
  // Optional decoration, opaque pass-through, defaults to empty if never called.
  headers: (headers: Record<string, unknown>) => EventInstance<P>;

  // --- Reads ---
  get: {
    id: () => string;
    topic: () => string;
    payload: () => P;
    created: () => string;
    // Staging fields — undefined until the event is added to an aggregate.
    position: () => number | undefined;
    aggregate: () => AggregateRefV1Type | undefined;
    creator: () => CreatorSchemaV1Type | undefined;
    headers: () => Record<string, unknown>;
  };

  // --- The aggregate's staging seam (not called by consumers) ---
  // aggregate.events.add() calls this to assign the provisional position + aggregate
  // reference as the event is staged. Returns the staged instance.
  stage: (ref: AggregateRefV1Type, position: number) => EventInstance<P>;

  // --- Right-to-forget ---
  // Apply the named stripper from this event's definition, returning a NEW instance with
  // the same identity (id/position/topic/aggregate/creator/headers/created) and a redacted
  // payload. No matching stripper → a new instance with the payload unchanged (a no-op),
  // so an aggregate can strip every event uniformly. Pure; nothing mutated in place.
  strip: (context: string) => EventInstance<P>;

  // Validate payload (against the definition schema) AND the whole envelope, then yield
  // the finished fact. Throws if called before staging — an unstaged event has no
  // position/aggregate/creator and cannot form a full envelope.
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
    creator: (entity, uid) => ((data.creator = { entity, uid }), dsl),
    headers: (headers) => ((data.headers = headers), dsl),
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
    stage: (ref, position) => ((data.aggregate = ref), (data.position = position), dsl),
    strip: (context) => {
      const stripper = strippers.get(context);
      const payload = stripper ? stripper(data.payload) : data.payload;
      // New instance, same identity/metadata, redacted payload. Never mutate in place.
      return make(schema, strippers, { ...data, payload });
    },
    // Validate payload against the definition schema, then the whole envelope. An unstaged
    // event fails here (position/aggregate/creator absent) — by design.
    build: () => EventEnvelopeV1.parse({ ...data, payload: schema.parse(data.payload) }),
  };
  return dsl;
};

// Fresh creation: mint id + created eagerly (captured as facts, never replayed); staging
// fields stay unset until an aggregate assigns them. Behind EventDefinition.create().
export const eventInstance = <P>(
  topic: string,
  schema: ZodType<P>,
  strippers: Map<string, Stripper<P>>,
  payload: P,
): EventInstance<P> =>
  make(schema, strippers, { id: nanoid(), topic, payload, created: new Date().toISOString(), headers: {} });

// Rehydration from a complete, already-persisted envelope — behind EventDefinition.restore().
// Mints NO new id/created: it carries the stored identity/metadata through, re-validating
// both envelope and payload. The shared `strippers` map keeps a committed event strippable.
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
