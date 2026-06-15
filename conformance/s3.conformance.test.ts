// S3 adapter through the SAME parameterized conformance suite — the first real adapter, run
// against MinIO (the fixture probed viable). The adapter is resolved by PACKAGE NAME (built
// dist), the way a consumer installs it — clean-build certification, not source. The harness
// (runConformance) is test infrastructure, imported from source.
//
// makeStorage yields a CLEAN store per test via a unique key-prefix namespace inside one
// bucket (same-bucket-different-prefix is the configurable destination; spanning buckets would
// be spread). Run: docker compose -f conformance/docker-compose.yml up -d minio, then vitest.
import { randomUUID } from "node:crypto";
import { s3Storage } from "@hilaryosborne/sourcing-adapter-s3";
import { runConformance } from "../packages/persistence/src/conformance/conformance";
import { ensureBucket, minioS3Client } from "./minio-s3-client";

const BUCKET = "conformance";
const client = minioS3Client();

const makeStorage = async () => {
  await ensureBucket(BUCKET);
  // A GLOBALLY-UNIQUE prefix namespace per store = a clean store every time, independent of
  // leftover objects from a prior run in the persistent bucket (the suite reuses fixed
  // stream/projection ids, so isolation must come from the prefix, not from a fresh container).
  const ns = randomUUID();
  return s3Storage(client, { bucket: BUCKET }, { events: `${ns}/aggregates`, projections: `${ns}/projections` });
};

runConformance(makeStorage);
