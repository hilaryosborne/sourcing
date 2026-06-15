// Public API barrel for @hilaryosborne/sourcing-adapter-s3 — the S3 object-store
// implementation of StorageI (the brutal adapter; FOUNDATION §"Storage adapter scope").
// The S3 client is INJECTED via S3ClientPort, so the concrete AWS/MinIO wiring is supplied
// by the consumer. Conformance-certified against MinIO via the StorageI conformance suite.
export { s3Storage } from "./s3-storage";
export type { S3Config } from "./s3-storage";
export type { S3ClientPort } from "./s3-client";
