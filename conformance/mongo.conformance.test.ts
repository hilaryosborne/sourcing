// Mongo adapter through the SAME parameterized conformance suite — the LAST real adapter, the
// interesting MIDDLE (a real conditional-update/unique-index story, but no single-statement
// multi-document atomicity, so append/overwrite ride a TRANSACTION → the replica-set floor).
// Resolved by PACKAGE NAME (built dist), the way a consumer installs it — clean-build
// certification. The harness (runConformance) is test infrastructure, imported from source.
// Adapter-blind assertions; the only Mongo-specific code is the fixture below.
//
// This is the leg the S3-first calibration was protecting: the hostile-key round-trip points at
// Mongo's BSON field-name rules ($-prefixed / dotted keys), the case most likely to find a REAL
// divergence against a backend whose document rules genuinely differ from JSON.
//
// CLEAN store per test via UNIQUE COLLECTION NAMES per makeStorage: the async factory ensures
// the unique index at construction, so a fresh pair of collection names = a fresh, correctly
// indexed store, independent of leftover documents (the suite reuses fixed stream/projection
// ids, so isolation comes from the destination, not a clean container). The id is hex
// (letter-prefixed) so it satisfies the adapter's collection-name guard.
// Run: docker compose -f conformance/docker-compose.yml up -d mongo, initiate the replica set,
// then vitest.
import { randomUUID } from "node:crypto";
import { afterAll } from "vitest";
import { mongoStorage } from "@hilaryosborne/sourcing-adapter-mongo";
import { runConformance } from "../packages/persistence/src/conformance/conformance";
import { closeMongoClient, connectMongo, mongoClient } from "./mongo-client";

const client = mongoClient();

const makeStorage = async () => {
  await connectMongo();
  const ns = randomUUID().replace(/-/g, "");
  return mongoStorage(client, { events: `evt_${ns}`, projections: `prj_${ns}` });
};

afterAll(async () => {
  await closeMongoClient();
});

runConformance(makeStorage);
