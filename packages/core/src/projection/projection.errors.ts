// Mechanical-only error codes for the projection layer. "The only errors a projection
// raises are mechanical — a malformed mapper, a validation failure on the produced
// model" (FOUNDATION §Projections).
// A regular `enum` (not `const enum`): consumers switch on these codes across a package
// boundary, which a const enum cannot support under verbatimModuleSyntax. Same codes/values.
export enum ProjectionErrors {
  // Two mappers registered for the same topic within one projection — a collision
  // within a single scope (FOUNDATION §Events, topic uniqueness is local).
  TOPIC_DUPLICATE = "PROJECTION_TOPIC_DUPLICATE",

  // The folded read-model failed the output schema on build(). Validated on EVERY
  // build, not just the first.
  OUTPUT_INVALID = "PROJECTION_OUTPUT_INVALID",

  // A mapper is structurally malformed (e.g. missing event definition or function).
  MAPPER_INVALID = "PROJECTION_MAPPER_INVALID",

  // handle() given an event not registered on the bound aggregate. A projection can only
  // map events its aggregate declares legal (checked when an aggregate is bound).
  EVENT_UNREGISTERED = "PROJECTION_EVENT_UNREGISTERED",
}
