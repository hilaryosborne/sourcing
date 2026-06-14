// Mechanical-only error codes for the aggregate layer. The aggregate enforces NO
// business rules (FOUNDATION §Aggregates) — every code here is a structural fault,
// never a judgement about whether an event "should" exist.
// A regular `enum` (not `const enum`): consumers switch on these codes across a package
// boundary, which a const enum cannot support under verbatimModuleSyntax. Same codes/values.
export enum AggregateErrors {
  // Two event definitions registered for the same topic on ONE aggregate definition.
  // Topic uniqueness is local to the definition that registers it (FOUNDATION §Events).
  TOPIC_DUPLICATE = "AGGREGATE_TOPIC_DUPLICATE",

  // events.add() given an event whose topic is not registered on this aggregate.
  // A container can only hold the events declared legal on its definition.
  TOPIC_UNKNOWN = "AGGREGATE_TOPIC_UNKNOWN",

  // events.add() reached with an event that carries no creator. Provenance is required at
  // staging and has no default — a missing creator fails loudly (FOUNDATION §Events).
  MISSING_CREATOR = "AGGREGATE_MISSING_CREATOR",

  // import() given an event that fails the envelope schema. Loading durable history
  // re-parses it on the way in (style: parse even your own store's reads).
  EVENT_INVALID = "AGGREGATE_EVENT_INVALID",
}
