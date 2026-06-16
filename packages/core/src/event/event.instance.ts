// The event instance — a STANDALONE, fluent builder (contract C, ratified; versioned in
// Epic 8). It is what `EventDef.create(payload)` returns: the consumer decorates it with
// `.creator()` / `.headers()`, then an aggregate stamps its position + reference via
// `stage()` when it is added (FOUNDATION §Events). The same instance type covers an
// unstaged event (no position/aggregate yet), a staged event, and a rehydrated committed
// event — they differ only in which fields are set.
//
// Versioning (FOUNDATION §"Versions & upcasters"). An instance retains its STORED payload
// and STORED version ordinal; three reads diverge deliberately:
//   • get.payload()/consume() → the payload UPCAST to head    (read-only; what consumers see)
//   • build()                 → the STORED payload + ordinal   (faithful persistence; never upcast)
//   • strip()                 → redact at the STORED version, re-validate, same ordinal
// New events are born at head, so for them stored == head and no upcast runs.
//
// Functional mode (coding-style §5 / functional-dsl) — a closure over a `data` object,
// not a class. Reads under `get`, the staging seam is `stage()`, terminal `build()`/
// `consume()` validate at the boundary.
import { nanoid } from "nanoid";
import { EventEnvelopeV1 } from "./event.schema";
import type { AggregateRefV1Type, CreatorSchemaV1Type, EventEnvelopeV1Type } from "./event.schema";
import type { VersionChain } from "./event";
import { assertUpcastsPresent, entryAt } from "./event";
import { EventErrors } from "./event.errors";

// A standalone event instance. Built by EventDefinition.create(), decorated fluently,
// then handed to aggregate.events.add() which stages it. `P` is the HEAD payload type —
// what every consumer-facing read yields.
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
    // The HEAD-shape payload: the stored payload lifted through the upcast chain. This is
    // what consumers meet; a malformed upcaster surfaces as EventErrors.UPCAST_INVALID.
    payload: () => P;
    // The opaque stored ordinal — which version this event was written at. Diagnostics
    // and persistence only; core never interprets it beyond counting from it.
    version: () => number;
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
  // Apply the named stripper from this event's STORED version, returning a NEW instance
  // with the same identity (id/position/topic/aggregate/creator/headers/created) and
  // STORED ordinal, and a redacted STORED payload. The redacted payload is re-validated
  // against its own version's schema (invalid → EventErrors.STRIP_INVALID). No matching
  // stripper → a new instance with the payload unchanged (a no-op), so an aggregate can
  // strip every event uniformly. Pure; nothing mutated in place.
  strip: (context: string) => EventInstance<P>;

  // Persistence envelope: validate the STORED payload against its version's schema AND the
  // whole envelope, then yield the finished fact — payload and ordinal exactly as stored,
  // never upcast. Throws if called before staging (no position/aggregate/creator).
  build: () => EventEnvelopeV1Type;

  // Consumption envelope: the full envelope with the payload UPCAST to head — what the
  // projection fold reads (mappers key off the head definition, so they require head shape).
  // The stored ordinal is preserved in the envelope; only the payload is lifted.
  consume: () => EventEnvelopeV1Type;
}

// The instance's mutable working state. The ONE sanctioned place to mutate (style
// "Immutability") — internal builder state, copied on the way out via build()/strip().
// `payload` and `version` are the STORED pair; consumer reads derive head from them.
// Payload is `unknown` internally (the chain is type-erased); the typed view `P` is
// reattached by a single cast at the eventInstance()/…FromEnvelope() boundaries below.
interface EventData {
  id: string;
  topic: string;
  payload: unknown;
  version: number;
  created: string;
  headers: Record<string, unknown>;
  position?: number;
  aggregate?: AggregateRefV1Type;
  creator?: CreatorSchemaV1Type;
}

// Lift a STORED payload to head by applying each later version's upcast in order. Pure;
// returns the stored payload unchanged when it is already at head (the new-event case).
// Ordinals are 1-based, so the walk runs from the next version up to the head number
// (chain.length). A malformed upcast is a mechanical fault (UPCAST_INVALID), at the boundary.
const toHead = (chain: VersionChain, version: number, stored: unknown): unknown => {
  let payload = stored;
  for (let next = version + 1; next <= chain.length; next++) {
    const entry = entryAt(chain, next);
    try {
      payload = entry.schema.parse(entry.upcast!(payload));
    } catch (cause) {
      throw new Error(EventErrors.UPCAST_INVALID, { cause });
    }
  }
  return payload;
};

// Validate a head payload at the create() boundary, tagging the mechanical fault and
// preserving the ZodError on cause. (restore() parses against the stored version's schema
// raw; upcast/strip tag their own codes.)
const parseOrThrow = (chain: VersionChain, payload: unknown): unknown => {
  try {
    return entryAt(chain, chain.length).schema.parse(payload);
  } catch (cause) {
    throw new Error(EventErrors.PAYLOAD_INVALID, { cause });
  }
};

// The shared dsl assembly. Both fresh creation and envelope rehydration funnel here,
// differing only in how `data` is seeded — so identity handling lives in one place.
// Internally untyped (EventInstance<unknown>); callers cast to the view type.
const make = (chain: VersionChain, data: EventData): EventInstance<unknown> => {
  const storedSchema = () => entryAt(chain, data.version).schema;
  const headPayload = () => toHead(chain, data.version, data.payload);
  const dsl: EventInstance<unknown> = {
    creator: (entity, uid) => ((data.creator = { entity, uid }), dsl),
    headers: (headers) => ((data.headers = headers), dsl),
    get: {
      id: () => data.id,
      topic: () => data.topic,
      payload: () => headPayload(),
      version: () => data.version,
      created: () => data.created,
      position: () => data.position,
      aggregate: () => data.aggregate,
      creator: () => data.creator,
      headers: () => data.headers,
    },
    stage: (ref, position) => ((data.aggregate = ref), (data.position = position), dsl),
    strip: (context) => {
      const stripper = entryAt(chain, data.version).strippers.get(context);
      if (!stripper) return make(chain, { ...data }); // no-op: new instance, payload unchanged
      const redacted = stripper(data.payload);
      try {
        storedSchema().parse(redacted); // redaction must stay valid for its own version
      } catch (cause) {
        throw new Error(EventErrors.STRIP_INVALID, { cause });
      }
      return make(chain, { ...data, payload: redacted });
    },
    // STORED payload + ordinal, validated against the stored version's schema then the
    // whole envelope. An unstaged event fails here (position/aggregate/creator absent).
    build: () => EventEnvelopeV1.parse({ ...data, payload: storedSchema().parse(data.payload) }),
    // HEAD payload (upcast + head-validated by toHead), stored ordinal preserved.
    consume: () => EventEnvelopeV1.parse({ ...data, payload: headPayload() }),
  };
  return dsl;
};

// Fresh creation: an event is born at HEAD (the highest declared version number =
// chain.length). The payload is validated against the head schema here (PAYLOAD_INVALID),
// and the definition's later-version upcasts are asserted present at this first use. Mint id
// + created eagerly (captured as facts, never replayed); staging fields stay unset until an
// aggregate assigns them. Behind EventDefinition.create() — payload is `unknown` until validated.
export const eventInstance = (topic: string, chain: VersionChain, payload: unknown): EventInstance<unknown> => {
  assertUpcastsPresent(chain);
  return make(chain, {
    id: nanoid(),
    topic,
    payload: parseOrThrow(chain, payload),
    version: chain.length,
    created: new Date().toISOString(),
    headers: {},
  });
};

// Rehydration from a complete, already-persisted envelope — behind EventDefinition.restore().
// Mints NO new id/created: it carries the stored identity/metadata/ordinal through. The
// definition's later-version upcasts are asserted present at this first use, and the stored
// payload is validated against ITS version's schema (envelope.version, 1-based, default 1).
export const eventInstanceFromEnvelope = (
  chain: VersionChain,
  envelope: EventEnvelopeV1Type,
): EventInstance<unknown> => {
  assertUpcastsPresent(chain);
  const parsed = EventEnvelopeV1.parse(envelope);
  return make(chain, {
    id: parsed.id,
    topic: parsed.topic,
    payload: entryAt(chain, parsed.version).schema.parse(parsed.payload),
    version: parsed.version,
    created: parsed.created,
    headers: parsed.headers,
    position: parsed.position,
    aggregate: parsed.aggregate,
    creator: parsed.creator,
  });
};
