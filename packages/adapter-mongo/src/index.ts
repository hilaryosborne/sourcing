// DRAFT — Epic 4, Phase C. Public API barrel for @hilaryosborne/sourcing-adapter-mongo — the
// document-store implementation of StorageI (the interesting MIDDLE between S3 and Postgres).
// The Mongo client is INJECTED via MongoClientPort, so the concrete `mongodb` wiring is a
// Phase D detail. Awaiting per-artefact ratification of the concurrency and
// overwrite-by-(stream, position) shapes before the conformance suite locks the contract.
export { mongoStorage } from "./mongo-storage";
export { isDuplicateKey, DUPLICATE_KEY_CODE } from "./mongo-client";
export type { MongoClientPort, MongoOps, MongoFilter, MongoDocument, MongoFindOptions } from "./mongo-client";
