// Mechanical-only error codes for cross-stream read models. Thrown as `new Error(...)`, switched
// on by consumers — never business judgement. One enum per module, matching the core convention.
// A regular enum (not const enum): consumed across package boundaries under verbatimModuleSyntax.
export enum ReadModelErrors {
  // The folded read-model state failed its output schema. Validated on every fold, like a
  // stored projection — a malformed cross-stream fold fails loudly.
  OUTPUT_INVALID = "READMODEL_OUTPUT_INVALID",

  // Two handlers registered for the same topic within one read model — a collision within a
  // single scope (topic uniqueness is local, exactly as for projections).
  TOPIC_DUPLICATE = "READMODEL_TOPIC_DUPLICATE",

  // A structurally malformed handler registration (missing event definition or non-function).
  MAPPER_INVALID = "READMODEL_MAPPER_INVALID",
}
