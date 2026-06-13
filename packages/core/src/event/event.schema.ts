// The event envelope: the metadata that wraps every event, plus the value-object
// schemas it composes. FOUNDATION.md §Events is the law for what lives here.
//
// Payload note: the envelope types `payload` as `unknown` ON PURPOSE. The event
// *definition* (event.ts) owns the payload schema and is "the only thing that
// deeply understands its own payload". The envelope validates the metadata; the
// definition validates the payload. An instance.build() runs both.
import { object, string, number, record, unknown } from "zod";
import type { z } from "zod";

// Provenance of an immutable fact. Required at staging, no default — "a permanent
// immutable event with bogus provenance is worse than one that refuses to be
// created" (FOUNDATION §Events). Core never interprets it; it is opaque pass-through.
export const CreatorSchemaV1 = object({
  entity: string().min(1),
  uid: string().min(1),
});
export type CreatorSchemaV1Type = z.infer<typeof CreatorSchemaV1>;

// The aggregate an event belongs to: id + definition name. Assigned at staging,
// because only the aggregate knows its own id and name. This is the event's single
// "aggregate reference" — NOT a second position (position is one top-level field).
export const AggregateRefV1 = object({
  id: string().min(1),
  name: string().min(1),
});
export type AggregateRefV1Type = z.infer<typeof AggregateRefV1>;

// The event envelope. Lifecycle of its fields (FOUNDATION §Events):
//   created at creation : id, topic, payload, created
//   assigned at staging : position, aggregate, creator, headers
// A freshly-created-but-unstaged event therefore cannot satisfy this schema yet —
// build() only yields a full envelope once the event has been staged onto a bowl
// (staging fills position/aggregate/creator; parse() rejects them missing).
export const EventEnvelopeV1 = object({
  // Intrinsic identity, assigned eagerly at creation so a staged event is
  // referenceable before persistence exists. Generated with nanoid.
  id: string().min(1),

  // Opaque unique string (e.g. "file.create.v1"). Core never parses or relates it.
  topic: string().min(1),

  // Single, stream-local index within this aggregate's stream. Provisional at
  // staging; 0-based. Cross-stream/global sequence is the cook's concern, not here.
  position: number().int().min(0),

  aggregate: AggregateRefV1,
  creator: CreatorSchemaV1,

  // Optional decoration, opaque pass-through, defaults to empty.
  headers: record(string(), unknown()).default({}),

  // ISO-8601 timestamp, captured ONCE as a fact at creation (determinism, style §11)
  // — never re-derived on replay.
  created: string().min(1),

  // Validated by the event definition's schema, not by the envelope. See file head.
  payload: unknown(),
});
export type EventEnvelopeV1Type = z.infer<typeof EventEnvelopeV1>;
