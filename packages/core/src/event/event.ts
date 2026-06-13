// The `event()` definition factory — the primary public primitive of the event
// layer. An event definition owns a topic, the payload schema (the only thing that
// "deeply understands its own payload"), and a registry of named strippers. It mints
// instances via create() and rehydrates them via restore(). Lowercase single-word
// factory (coding-style naming).
import type { ZodType } from "zod";
import type { EventInstance } from "./event.instance";
import type { EventEnvelopeV1Type } from "./event.schema";
import { eventInstance, eventInstanceFromEnvelope } from "./event.instance";
import { EventErrors } from "./event.errors";

// A stripper is a PURE redaction: payload in, redacted payload out. Registered by a
// context name ("gdpr", "export-redaction", …) so erasure can be contextual. Same
// shape in and out — it redacts fields, it does not change the payload's type.
export type Stripper<P = unknown> = (payload: P) => P;

// The event definition: the outer factory return. `strip()` registers a named
// stripper and chains; `create()` mints a new fact; `restore()` rehydrates an old one.
export interface EventDefinition<P = unknown> {
  topic: string;
  schema: ZodType<P>;
  // Register a contextual stripper. Re-using a name on one definition is a collision
  // within a single scope → EventErrors.STRIPPER_DUPLICATE.
  strip: (context: string, stripper: Stripper<P>) => EventDefinition<P>;
  // Validate `payload` against `schema`, assign id + created eagerly, return an
  // unstaged instance. Staging (position/aggregate/creator) happens on the bowl.
  create: (payload: P) => EventInstance<P>;
  // The symmetric partner to create(): rehydrate an EventInstance from a complete,
  // already-persisted envelope WITHOUT minting new identity — it keeps the stored
  // id/position/creator/headers/created and re-validates the payload. This is what
  // AggregateInstance.import() uses so committed history stays strippable/exportable.
  restore: (envelope: EventEnvelopeV1Type) => EventInstance<P>;
}

// Validate at the boundary, tag the mechanical fault, preserve the ZodError on cause.
const parsePayload = <P>(schema: ZodType<P>, payload: P): P => {
  try {
    return schema.parse(payload);
  } catch (cause) {
    throw new Error(EventErrors.PAYLOAD_INVALID, { cause });
  }
};

// event("file.create.v1", z.object({ ... }))
//   .strip("gdpr", (p) => ({ ...p, name: undefined }))
// The three-way lockstep holds: filename ↔ topic string ↔ exported symbol.
const event = <P>(topic: string, schema: ZodType<P>): EventDefinition<P> => {
  const strippers = new Map<string, Stripper<P>>();
  const definition: EventDefinition<P> = {
    topic,
    schema,
    strip: (context, stripper) => {
      if (strippers.has(context)) throw new Error(EventErrors.STRIPPER_DUPLICATE);
      strippers.set(context, stripper);
      return definition;
    },
    create: (payload) => eventInstance(topic, schema, strippers, parsePayload(schema, payload)),
    restore: (envelope) => eventInstanceFromEnvelope(schema, strippers, envelope),
  };
  return definition;
};

export default event;
