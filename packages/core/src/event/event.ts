// The `event()` definition factory — the primary public primitive of the event layer
// (contract C, ratified; versioned in Epic 8). A definition owns a base topic and an
// ORDERED chain of versions, each with a payload schema, named strippers, and — from the
// second version onward — an upcast (previous output → this output). It mints STANDALONE
// instances via create() (always at the head version) and rehydrates committed ones via
// restore() (at their stored ordinal). Events are not bound to any aggregate — the same
// definition may be registered on many (FOUNDATION §Events: topic uniqueness is
// per-aggregate, never global).
//
// The builder is a TYPE-STATE machine that encodes three compile-time guarantees
// (FOUNDATION §"Versions & upcasters"):
//   1. the FIRST version cannot upcast      — version() → EventDefinition (no .upcast)
//   2. every LATER version MUST upcast        — version() → VersionPending (ONLY .upcast reachable)
//   3. an upcast's input IS the prev output   — VersionPending<Prev, Cur>.upcast((e: Prev) => Cur)
import type { ZodType } from "zod";
import type { EventInstance } from "./event.instance";
import type { EventEnvelopeV1Type } from "./event.schema";
import { eventInstance, eventInstanceFromEnvelope } from "./event.instance";
import { EventErrors } from "./event.errors";

// A stripper is a PURE redaction: payload in, redacted payload out. Registered by a
// context name ("gdpr", "export-redaction", …) so erasure can be contextual. Same shape
// in and out — it redacts fields, it does not change the payload's type. Scoped per version.
export type Stripper<P = unknown> = (payload: P) => P;

// The payload type a Zod schema validates (its output) — the per-version shape.
type Output<S> = S extends ZodType<infer P> ? P : never;

// One link in the version chain: its schema, its named strippers, and (absent on the first
// version) the upcast that lifts the PREVIOUS version's output into this one. Payload-erased
// internally; the typed builder surface is what enforces correctness. `version.length - 1`
// is the head ordinal. Consumed by the instance to upcast / strip / build.
export interface VersionEntry<P = unknown> {
  schema: ZodType<P>;
  upcast?: (previous: unknown) => unknown;
  strippers: Map<string, Stripper<P>>;
}
export type VersionChain = VersionEntry[];

// The version at an ordinal, or a mechanical error if the chain does not declare it (a
// stored ordinal beyond the known versions). Used by the instance and the builder so an
// out-of-range ordinal surfaces as VERSION_UNKNOWN rather than reading off the end.
export const entryAt = (chain: VersionChain, version: number): VersionEntry => {
  const entry = chain[version];
  if (!entry) throw new Error(EventErrors.VERSION_UNKNOWN);
  return entry;
};

// The HEAD definition (the "complete" type-state). `P` is the head payload shape. Because
// each chain step returns the next state, the value held after the final version()/upcast()
// IS the head definition — no terminal call is needed (mirrors the prior flat factory).
export interface EventDefinition<P = unknown> {
  topic: string;
  // Register a contextual stripper for the CURRENT (head) version's shape. Re-using a name
  // on one version is a scope collision → EventErrors.STRIPPER_DUPLICATE.
  strip: (context: string, stripper: Stripper<P>) => EventDefinition<P>;
  // Add the NEXT version. Gates through VersionPending: its upcast is mandatory before the
  // definition is usable again (create/restore/strip/version are unreachable until then).
  version: <S extends ZodType>(schema: S) => VersionPending<P, Output<S>>;
  // Build a STANDALONE event at the HEAD version: validate `payload` against the head
  // schema, assign id + created eagerly, and return an unstaged instance ready for
  // `.creator()` / `.headers()` and `aggregate.events.add()`.
  create: (payload: P) => EventInstance<P>;
  // Rehydrate an EventInstance from an already-persisted envelope at ITS stored ordinal,
  // re-validating the stored payload against that version's schema WITHOUT minting new
  // identity. This is what aggregate.events.import() uses so committed history stays
  // strippable/exportable; consumer reads still see the head shape (upcast).
  restore: (envelope: EventEnvelopeV1Type) => EventInstance<P>;
}

// The "pending" type-state: a later version awaiting its MANDATORY upcast. The only method
// is `.upcast`; nothing else is reachable until it is supplied, so a dangling Pending is an
// unusable definition — which is how "every later version must upcast" is enforced.
export interface VersionPending<Prev, Cur> {
  // Input is the PREVIOUS version's output; the return is forced to THIS version's output.
  upcast: (fn: (previous: Prev) => Cur) => EventDefinition<Cur>;
}

// The no-version entry state: the base topic exists; only a first version may be added.
export interface EventStart {
  // The FIRST version routes straight to EventDefinition (which has NO .upcast member), so
  // the first version structurally cannot declare one (nothing precedes it).
  version: <S extends ZodType>(schema: S) => EventDefinition<Output<S>>;
}

// Assemble the head definition over a shared, growing chain. `head` is captured per state,
// so create() always mints at THIS definition's head even if the chain grows later. Internals
// are payload-erased; the typed interfaces above are the contract the casts honour.
const complete = (topic: string, chain: VersionChain, head: number): EventDefinition => {
  const definition: EventDefinition = {
    topic,
    strip: (context, stripper) => {
      const entry = entryAt(chain, head);
      if (entry.strippers.has(context)) throw new Error(EventErrors.STRIPPER_DUPLICATE);
      entry.strippers.set(context, stripper as Stripper);
      return definition;
    },
    version: ((schema: ZodType) => pending(topic, chain, schema)) as EventDefinition["version"],
    create: (payload) => eventInstance(topic, chain, parseOrThrow(entryAt(chain, head).schema, payload)),
    restore: (envelope) => eventInstanceFromEnvelope(chain, envelope),
  };
  return definition;
};

// The pending state: hold the next version's schema; commit it to the chain only when the
// mandatory upcast arrives, then return the new head definition.
const pending = (topic: string, chain: VersionChain, schema: ZodType): VersionPending<unknown, unknown> => ({
  upcast: (fn) => {
    chain.push({ schema, upcast: fn as (previous: unknown) => unknown, strippers: new Map() });
    return complete(topic, chain, chain.length - 1);
  },
});

// Validate a head payload at the create() boundary, tagging the mechanical fault and
// preserving the ZodError on cause. restore()/build() parse against their version schemas
// raw (the aggregate wraps a bad import as EVENT_INVALID); upcast/strip tag their own codes.
const parseOrThrow = (schema: ZodType, payload: unknown): unknown => {
  try {
    return schema.parse(payload);
  } catch (cause) {
    throw new Error(EventErrors.PAYLOAD_INVALID, { cause });
  }
};

// event("account.opened")
//   .version(z.object({ holder: z.string().min(1) }))
//     .strip("gdpr", (p) => ({ holder: "[redacted]" }))
//   .version(z.object({ holder: z.object({ name: z.string().min(1) }), category: z.string().min(1) }))
//     .upcast((e) => ({ holder: { name: e.holder }, category: "unknown" }))
//     .strip("gdpr", (p) => ({ holder: { name: "[redacted]" }, category: p.category }));
// The three-way lockstep holds: filename ↔ base topic string ↔ exported symbol.
const event = (topic: string): EventStart => {
  const chain: VersionChain = [];
  return {
    version: ((schema: ZodType) => {
      chain.push({ schema, strippers: new Map() });
      return complete(topic, chain, chain.length - 1);
    }) as EventStart["version"],
  };
};

export default event;
