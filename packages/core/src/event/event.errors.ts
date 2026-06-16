// Mechanical-only error codes for the event layer. Tagged codes a consumer can
// switch on — never business judgement (coding-style "Errors", FOUNDATION "the only
// errors the core raises are mechanical"). Thrown as `new Error(EventErrors.X)`, with
// the underlying ZodError preserved on `.cause` where a schema parse failed.
// A regular `enum` (not `const enum`): consumers switch on these codes across a package
// boundary, which a const enum cannot support under verbatimModuleSyntax. Same codes/values.
export enum EventErrors {
  // A payload failed its definition's schema on create().
  PAYLOAD_INVALID = "EVENT_PAYLOAD_INVALID",

  // Two strippers registered under the same name on one event VERSION — a
  // collision within a single scope, the only kind of collision that is an error.
  STRIPPER_DUPLICATE = "EVENT_STRIPPER_DUPLICATE",

  // A stripper's output failed its own version's schema. Redaction must produce a
  // schema-valid payload (strip to a sentinel, not to a value the schema forbids);
  // FOUNDATION §Strippers. The ZodError is preserved on `.cause`.
  STRIP_INVALID = "EVENT_STRIP_INVALID",

  // An upcast produced a payload that failed the next version's schema while lifting a
  // stored event toward head. A malformed upcaster is a mechanical fault, like a malformed
  // mapper — never business judgement. The ZodError is preserved on `.cause`.
  UPCAST_INVALID = "EVENT_UPCAST_INVALID",

  // A persisted event carries a version ordinal the definition does not declare (e.g. its
  // chain was shortened). Core counts from the ordinal and cannot find that version — a
  // mechanical fault, surfaced rather than read off the end of the chain.
  VERSION_UNKNOWN = "EVENT_VERSION_UNKNOWN",

  // A version() call declared an ordinal that breaks the contiguous-from-1 sequence: the
  // first version was not 1, a later version was not (previous + 1), or a number was
  // duplicated / out of order. The declared number IS the persisted ordinal, so the
  // sequence must be exact — a gap or duplicate is a mechanical authoring fault.
  VERSION_SEQUENCE = "EVENT_VERSION_SEQUENCE",

  // .upcast() was declared on the FIRST version. Nothing precedes version 1, so it has
  // nothing to lift from — a mechanical authoring fault, raised at the call site.
  UPCAST_ON_FIRST_VERSION = "EVENT_UPCAST_ON_FIRST_VERSION",

  // A version after the first was declared without the mandatory upcast that lifts the
  // previous version's output into its own. Validated lazily at first use (create /
  // restore / consume / strip), because statement order means it cannot be known when the
  // version is added. A later version without an upcast is an unusable definition.
  UPCAST_MISSING = "EVENT_UPCAST_MISSING",
}
