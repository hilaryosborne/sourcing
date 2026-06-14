// DRAFT — Epic 4, Phase A (redraft). Mechanical-only error codes for the storage port.
// Tagged codes a consumer can switch on, thrown as `new Error(StorageErrors.X)` — never
// business judgement (interface-adapters §"Errors"). One const enum per module, matching
// core's EventErrors/AggregateErrors convention. Awaiting per-artefact ratification.
export const enum StorageErrors {
  // Optimistic concurrency: append() was given an expectedHead that no longer matches the
  // stream's actual head — two processes staged onto separately-loaded copies of the same
  // aggregate and both reached commit (FOUNDATION §Events: "reconciling that collision is
  // the repository's job"). The compare-and-append guard is a MANDATORY adapter capability
  // (FOUNDATION §"Single adapter per repository"); the repository surfaces this, the
  // consumer retries.
  VERSION_CONFLICT = "STORAGE_VERSION_CONFLICT",

  // overwrite() (right-to-forget) targeted a (stream, position) that is not stored. You can
  // only redact an event that actually exists. The match key is (stream, position) — within
  // one adapter, position is the unambiguous address of a fact.
  OVERWRITE_UNKNOWN_POSITION = "STORAGE_OVERWRITE_UNKNOWN_POSITION",
}
