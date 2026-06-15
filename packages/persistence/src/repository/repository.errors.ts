// Mechanical-only error codes for the repository. Tagged codes a consumer can switch on,
// thrown as `new Error(RepositoryErrors.X)` — never business judgement (matching core's
// EventErrors/AggregateErrors/ProjectionErrors and the storage layer's StorageErrors).
// A regular `enum` (not `const enum`) — consumed across package boundaries, which a const
// enum cannot be under verbatimModuleSyntax. Same codes, same values.
export enum RepositoryErrors {
  // A stored projection's bookmark sits AT OR PAST a head the stream cannot reach — the
  // projection claims to have folded events that do not exist. This is storage corruption,
  // NOT one of the three self-healing outcomes; rebuild refuses to proceed rather than
  // silently rebuild over a corrupt bookmark.
  PROJECTION_AHEAD_OF_HEAD = "REPOSITORY_PROJECTION_AHEAD_OF_HEAD",
}
