// DRAFT — Epic 3, Phase A. Public API surface for @hilaryosborne/sourcing — the bowl.
// In a published library the barrel IS the public API (coding-style "Files & modules"):
// it curates the surface. What is exported here is the contract; anything not exported
// is private. Shapes under review; awaiting per-artefact ratification (DRAFT-AND-HALT).
//
// The three primitives are the lowercase single-word factories (event/aggregate/
// projection). Types are derived and exported beside them; error vocabularies are
// exported so consumers can switch on mechanical faults.

// --- Events + strippers ---
export { default as event } from "./event/event";
export type { EventDefinition, Stripper } from "./event/event";
export type { EventInstance } from "./event/event.instance";
export { EventErrors } from "./event/event.errors";
export { EventEnvelopeV1, CreatorSchemaV1, AggregateRefV1 } from "./event/event.schema";
export type { EventEnvelopeV1Type, CreatorSchemaV1Type, AggregateRefV1Type } from "./event/event.schema";

// --- Aggregate (the bowl) ---
export { default as aggregate } from "./aggregate/aggregate";
export type { AggregateDefinition, AggregateInstance, RegisteredEvent } from "./aggregate/aggregate";
export type { StageDsl } from "./aggregate/aggregate.stage";
export { AggregateErrors } from "./aggregate/aggregate.errors";

// --- Projection (the pure builder) ---
export { default as projection } from "./projection/projection";
export type { ProjectionDefinition, ProjectionConfig, ProjectionHandler } from "./projection/projection";
export { ProjectionErrors } from "./projection/projection.errors";
