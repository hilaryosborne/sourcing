// Mechanical-only error codes for the event layer. Tagged codes a consumer can
// switch on — never business judgement (coding-style "Errors", FOUNDATION "the only
// errors the core raises are mechanical"). Thrown as `new Error(EventErrors.X)`, with
// the underlying ZodError preserved on `.cause` where a schema parse failed.
export const enum EventErrors {
  // A payload failed its definition's schema on create().
  PAYLOAD_INVALID = "EVENT_PAYLOAD_INVALID",

  // Two strippers registered under the same name on one event definition — a
  // collision within a single scope, the only kind of collision that is an error.
  STRIPPER_DUPLICATE = "EVENT_STRIPPER_DUPLICATE",
}
