// DRAFT — Epic 4, Phase A (redraft against the ratified core). The universal storage
// models — the shared currency every adapter maps its backend's shape into (interface-
// adapters §"Universal model"). Shapes under review; awaiting per-artefact ratification.
//
// Two things get persisted: events and projections.
//   - A stored event IS the core event envelope, verbatim. Storage adds nothing to it and
//     parses nothing in it — core already validated the envelope at build(). We alias the
//     core type rather than re-derive a parallel schema, so there is one source of truth
//     for "what an event is" and storage cannot drift from core.
//   - A stored projection is NEW here — core projections are pure derivations with no
//     persisted form. The store holds the read-model state plus the BOOKMARK (the position
//     of the last event it was folded from) so the self-healing algorithm can decide
//     stale-vs-current with a single cheap registry read (FOUNDATION §Scenario 2).
import { object, string, number, unknown } from "zod";
import type { z } from "zod";
import { AggregateRefV1 } from "@hilaryosborne/sourcing";
import type { AggregateRefV1Type, EventEnvelopeV1Type } from "@hilaryosborne/sourcing";

// A stream is one aggregate instance's event sequence. Its identity is the core aggregate
// reference (id + definition name) — position is stream-local to exactly this (FOUNDATION
// §Events). The adapter keys everything by this; it never invents its own stream identity.
export type StorageStream = AggregateRefV1Type;

// A stored event is the core envelope unchanged — including its intrinsic `id` (the event
// uid, a nanoid minted at creation). Aliased, not redefined.
//
// A backend MAY assign a global / cross-stream sequence number, but it is an OPTIONAL
// advertised capability, NOT part of this universal model or the shared port — the port
// promises no cross-stream ordering (FOUNDATION §"Single adapter per repository"). Adapters
// that can offer a cheap global order (e.g. a single Postgres) may expose it; those that
// can't (S3, absent an external sequencer) don't. Consumers needing cross-stream order opt
// into an adapter that provides it.
export type StoredEventV1Type = EventEnvelopeV1Type;

// A stored projection: the read-model state + the bookmark that makes self-healing cheap.
// Keyed by (aggregate, name).
export const StoredProjectionV1 = object({
  // Which stream this projection was built from. Half the storage key.
  aggregate: AggregateRefV1,

  // The projection's name — the OTHER half of the key. This is the projection's OWN name
  // (ProjectionDefinition.name in core), not a persistence-invented label: the ratified
  // core projection carries its identity, and that identity is the store key. (This is the
  // resolution of the earlier "projections are nameless" question — they aren't.)
  name: string().min(1),

  // The bookmark: position of the LAST event folded into `state`. Compared against the
  // registry head to choose no-build / delta / full-rebuild (FOUNDATION §Scenario 2).
  position: number().int().min(0),

  // The read-model itself. `unknown` ON PURPOSE — persistence does not know the shape; the
  // consumer's ProjectionDefinition owns and validates it on every rebuild (interface-
  // adapters §"Universal model": the escape hatch for backend data).
  state: unknown(),
});
export type StoredProjectionV1Type = z.infer<typeof StoredProjectionV1>;
