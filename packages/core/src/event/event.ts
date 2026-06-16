// The `event()` definition factory — the primary public primitive of the event layer
// (contract C, ratified; versioned in Epic 8, DSL reshaped in the ref-exact pass). A
// definition owns a base topic and an ORDERED chain of versions, each with a payload
// schema, named strippers, and — from the second version onward — an upcast (previous
// output → this output). It mints STANDALONE instances via create() (always at the head
// version) and rehydrates committed ones via restore() (at their stored ordinal). Events
// are not bound to any aggregate — the same definition may be registered on many
// (FOUNDATION §Events: topic uniqueness is per-aggregate, never global).
//
// The DSL is REF-EXACT: the definition is captured once in a const and `.version()` is
// called on it per version, the return usually discarded (registration is the call's side
// effect). `.version(n, schema)` returns a per-version builder carrying `.upcast`/`.strip`,
// scoped to THAT version. The declared number IS the persisted ordinal (1-based, contiguous).
//
// The three version invariants are RUNTIME-validated mechanical faults (FOUNDATION
// §"Versions & upcasters" — runtime, not compile-time):
//   1. .version(n) must continue the sequence    — n === count + 1, else VERSION_SEQUENCE
//   2. the FIRST version cannot upcast            — .upcast on version 1 → UPCAST_ON_FIRST_VERSION
//   3. every LATER version MUST upcast            — checked lazily at first use → UPCAST_MISSING
// The upcast's INPUT is `unknown` (the handle does not thread the previous output type);
// the upcast's RETURN and each version's strippers stay typed to that version's own schema.
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
// internally; the typed builder surface is what shapes the upcast return / strippers. The
// chain is an array; a version's 1-based ordinal is `index + 1` (contiguous-from-1 makes the
// mapping exact). Consumed by the instance to upcast / strip / build.
export interface VersionEntry<P = unknown> {
  schema: ZodType<P>;
  upcast?: (previous: unknown) => unknown;
  strippers: Map<string, Stripper<P>>;
}
export type VersionChain = VersionEntry[];

// The version at a 1-based ordinal, or a mechanical error if the chain does not declare it
// (a stored ordinal beyond the known versions). Used by the instance and the builder so an
// out-of-range ordinal surfaces as VERSION_UNKNOWN rather than reading off the end.
export const entryAt = (chain: VersionChain, version: number): VersionEntry => {
  const entry = chain[version - 1];
  if (!entry) throw new Error(EventErrors.VERSION_UNKNOWN);
  return entry;
};

// Lazily assert that every version after the first declares its mandatory upcast. Invoked
// at first use (create / restore / consume / strip) — statement order means a later
// version's upcast may be attached after the version is pushed, so it cannot be checked
// when the version is added. A non-first entry without an upcast is an unusable definition.
export const assertUpcastsPresent = (chain: VersionChain): void => {
  for (let index = 1; index < chain.length; index++) {
    if (!entryAt(chain, index + 1).upcast) throw new Error(EventErrors.UPCAST_MISSING);
  }
};

// The event definition handle: a base topic over a shared, MUTATING version chain. Captured
// once in a const; `.version()` is called on it per version, the return usually discarded.
// NOT parameterized by head payload — the handle's type does not advance as versions are
// added, so create()/restore() surface the payload as `unknown` (validated at runtime
// against the head/stored schema by the instance).
export interface EventDefinition {
  topic: string;
  // Declare a version at an explicit 1-based contiguous ordinal — the number IS the
  // persisted ordinal. Must equal (current count + 1): the first version is 1, each later
  // version is the previous + 1. A wrong number (not 1 first, gap, duplicate, out of order)
  // → EventErrors.VERSION_SEQUENCE. Returns a builder scoped to THIS version.
  version: <S extends ZodType>(version: number, schema: S) => VersionBuilder<Output<S>>;
  // Build a STANDALONE event at the HEAD version (highest declared number): validate
  // `payload` against the head schema at runtime, assign id + created eagerly, and return an
  // unstaged instance ready for `.creator()` / `.headers()` and `aggregate.events.add()`.
  create: (payload: unknown) => EventInstance<unknown>;
  // Rehydrate an EventInstance from an already-persisted envelope at ITS stored ordinal,
  // re-validating the stored payload against that version's schema WITHOUT minting new
  // identity. This is what aggregate.events.import() uses so committed history stays
  // strippable/exportable; consumer reads still see the head shape (upcast).
  restore: (envelope: EventEnvelopeV1Type) => EventInstance<unknown>;
}

// The per-version configuration builder, scoped to ONE version's entry. Both methods mutate
// that entry and return `this` for chaining; order-independent (.upcast / .strip either way).
export interface VersionBuilder<Cur> {
  // Declare the upcast lifting the PREVIOUS version's output into this one. Input is
  // `unknown` (the handle cannot thread the previous output type); the RETURN is forced to
  // THIS version's shape (Cur), still checked against this version's schema. Declaring an
  // upcast on the first version is a mechanical fault (UPCAST_ON_FIRST_VERSION).
  upcast: (fn: (previous: unknown) => Cur) => VersionBuilder<Cur>;
  // Register a named contextual stripper for THIS version's shape (FOUNDATION §Strippers).
  // Input and output are this version's shape. Re-using a context on one version is a
  // collision → EventErrors.STRIPPER_DUPLICATE.
  strip: (context: string, stripper: (payload: Cur) => Cur) => VersionBuilder<Cur>;
}

// Assemble the per-version builder over its own entry (already pushed to the shared chain).
// `isFirst` marks version 1, the only one that may not upcast. Internally payload-erased;
// the typed VersionBuilder<Cur> is the cast applied by version().
const versionBuilder = (entry: VersionEntry, isFirst: boolean): VersionBuilder<unknown> => {
  const builder: VersionBuilder<unknown> = {
    upcast: (fn) => {
      if (isFirst) throw new Error(EventErrors.UPCAST_ON_FIRST_VERSION);
      entry.upcast = fn;
      return builder;
    },
    strip: (context, stripper) => {
      if (entry.strippers.has(context)) throw new Error(EventErrors.STRIPPER_DUPLICATE);
      entry.strippers.set(context, stripper as Stripper);
      return builder;
    },
  };
  return builder;
};

// event("account.opened")
//   ; const AccountOpened = … then per version, off the captured const:
// AccountOpened.version(1, z.object({ holder: z.string().min(1) }))
//   .strip("gdpr", () => ({ holder: "" }));
// AccountOpened.version(2, z.object({ holder: z.object({ name: z.string().min(1) }), country: z.string().min(1) }))
//   .upcast((prev) => ({ holder: { name: (prev as V1).holder }, country: "unknown" }))
//   .strip("gdpr", (p) => ({ holder: { name: "" }, country: p.country }));
// The three-way lockstep holds: filename ↔ base topic string ↔ exported symbol.
const event = (topic: string): EventDefinition => {
  const chain: VersionChain = [];
  const definition: EventDefinition = {
    topic,
    version: ((version: number, schema: ZodType) => {
      // The declared number IS the ordinal; it must continue the contiguous-from-1 sequence.
      if (version !== chain.length + 1) throw new Error(EventErrors.VERSION_SEQUENCE);
      const entry: VersionEntry = { schema, strippers: new Map() };
      chain.push(entry);
      return versionBuilder(entry, chain.length === 1);
    }) as EventDefinition["version"],
    create: (payload) => eventInstance(topic, chain, payload),
    restore: (envelope) => eventInstanceFromEnvelope(chain, envelope),
  };
  return definition;
};

export default event;
