// DRAFT — Epic 4, Phase C (Mongo adapter — the interesting MIDDLE). The minimal Mongo
// surface the adapter needs, as an INJECTED port — the concrete `mongodb` driver is a Phase D
// wiring detail. Awaiting per-artefact ratification (DRAFT-AND-HALT.md).
//
// Mongo sits between S3 and Postgres: a real conditional-update / unique-index story (not
// S3-grim), but it LACKS single-statement multi-document atomicity (Postgres gets it from one
// statement; S3 from one object). So the one place the document model strains is ATOMICITY of
// a multi-document write — append (many event docs) and overwrite (many positions). The port
// carries a `transaction` primitive for exactly those; the contract is unchanged, the
// operational floor (a transaction-capable deployment, i.e. a replica set) is higher. That is
// the "third direction" — not a port-shape strain, a deployment one.
export type MongoFilter = Record<string, unknown>;
export type MongoDocument = Record<string, unknown>;
export interface MongoFindOptions {
  sort?: Record<string, 1 | -1>;
  limit?: number;
}

// The data operations — available directly (non-transactional) and inside a transaction.
export interface MongoOps {
  find<D = MongoDocument>(collection: string, filter: MongoFilter, options?: MongoFindOptions): Promise<D[]>;
  // Insert documents. Throws a duplicate-key error (code 11000) if a unique index collides —
  // this is the append compare-and-append. Atomicity across the docs is the caller's concern
  // (wrap in `transaction` for all-or-nothing).
  insertMany(collection: string, docs: ReadonlyArray<MongoDocument>): Promise<void>;
  // $set the given fields on the one matching doc. Resolves true if a doc matched, false if
  // none did (the overwrite miss signal).
  updateOne(collection: string, filter: MongoFilter, set: MongoDocument): Promise<boolean>;
  // Replace-or-insert the whole doc for the filter (last-write-wins; projection cache).
  upsertOne(collection: string, filter: MongoFilter, doc: MongoDocument): Promise<void>;
  deleteMany(collection: string, filter: MongoFilter): Promise<void>;
}

export interface MongoClientPort extends MongoOps {
  // Run `work` inside a multi-document transaction: ops via `tx` commit together if `work`
  // resolves, and abort together if it throws (leaving the store untouched). Requires a
  // transaction-capable deployment (replica set). This is how the adapter gets the
  // all-or-nothing that Postgres gets from a single statement.
  transaction<T>(work: (tx: MongoOps) => Promise<T>): Promise<T>;
  // Ensure a unique index exists (idempotent) — the compare-and-append depends on it.
  ensureUniqueIndex(collection: string, keys: Record<string, 1>): Promise<void>;
}

// Mongo duplicate-key SQLSTATE-equivalent. A collision on the (stream, position) unique index
// means another writer took the position → VERSION_CONFLICT.
export const DUPLICATE_KEY_CODE = 11000;
export const isDuplicateKey = (error: unknown): boolean =>
  typeof error === "object" && error !== null && (error as { code?: unknown }).code === DUPLICATE_KEY_CODE;
