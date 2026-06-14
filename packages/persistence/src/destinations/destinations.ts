// DRAFT — Epic 4, Phase C (configurable destinations). The §3 non-prohibition seam arriving
// concrete: the consumer configures WHERE each kind of thing lands, at persistence-init. An
// adapter interprets each name as a table / key-prefix / collection and uses it in place of
// a hardcoded one. This is how a consumer points projections at a different store from
// events WITHOUT the library solving spread (FOUNDATION §"Configurable destinations").
// Awaiting per-artefact ratification (DRAFT-AND-HALT.md).
//
// THE RULE: the library targets ONE destination per operation and NEVER coordinates across
// destinations — configurable, NOT coordinated. No operation (especially forget) is made
// atomic across two differently-located destinations; that is the distributed-transaction
// territory the single-adapter stance refuses. Configurability ≠ coordination.
//
// Three KINDS, configured independently. Aggregates are NOT a fourth kind: an aggregate's
// events ARE the event destination; there is no separate aggregate store (the snapshot was
// declined). If a snapshot is ever reintroduced it gets its own destination — out of scope.
export interface Destinations {
  // Where the event stream lives. Used by head / read / append / overwrite. The per-kind
  // name's meaning is the adapter's (S3 key-prefix, Postgres table, Mongo collection).
  events: string;

  // Where projections live. Used by loadProjection / saveProjection / deleteProjections —
  // and by forget's bin-all, which MUST bin at THIS configured destination, never one
  // derived from the event location. Colocation is the DEFAULT, not the ASSUMPTION.
  projections: string;

  // Where the registry (aggregate id → head) is read. The registry is a VIEW over the event
  // head (ratified Gate 2), so reference adapters read it from the EVENTS destination and
  // this DEFAULTS to `events`. Configure it separately only for an adapter that materializes
  // a registry (e.g. a head-pointer store); the RegistryI.head contract is unchanged either
  // way, so a separate registry destination does NOT reopen Gate 2. The slot configures
  // LOCATION, not semantics.
  registry?: string;
}

// Destinations with the optional slot filled. The registry defaults to the VALUE configured
// for events — NOT the literal keyword "events": if a consumer sets events: "my_event_table"
// and omits registry, the registry resolves to "my_event_table". An adapter resolves once at
// construction so the default-to-value rule lives in one place and cannot regress.
export interface ResolvedDestinations {
  events: string;
  projections: string;
  registry: string;
}

export const resolveDestinations = (destinations: Destinations): ResolvedDestinations => ({
  events: destinations.events,
  projections: destinations.projections,
  registry: destinations.registry ?? destinations.events,
});
