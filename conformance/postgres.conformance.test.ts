// Postgres adapter through the SAME parameterized conformance suite — the second real adapter
// (the easy backend, the inverse stress of S3). Resolved by PACKAGE NAME (built dist), the way
// a consumer installs it — clean-build certification, not source. The harness (runConformance)
// is test infrastructure, imported from source. Adapter-blind assertions; the only
// Postgres-specific code is the fixture below.
//
// CLEAN store per test via UNIQUE TABLE NAMES per makeStorage: the async factory CREATEs the
// events/projections tables (CREATE TABLE IF NOT EXISTS) and ensures the unique index at
// construction, so a fresh pair of names = a fresh, correctly-provisioned store — independent
// of any leftover rows in the shared database (the suite reuses fixed stream/projection ids, so
// isolation must come from the destination, not from a clean container). The id is hex (uuid
// minus dashes, letter-prefixed) so it satisfies the adapter's SQL_IDENTIFIER guard.
// Run: docker compose -f conformance/docker-compose.yml up -d postgres, then vitest.
import { randomUUID } from "node:crypto";
import { afterAll } from "vitest";
import { postgresStorage } from "@hilaryosborne/sourcing-adapter-postgres";
import { runConformance } from "../packages/persistence/src/conformance/conformance";
import { closePgClient, pgClient } from "./pg-client";

const client = pgClient();

const makeStorage = async () => {
  const ns = randomUUID().replace(/-/g, "");
  return postgresStorage(client, { events: `evt_${ns}`, projections: `prj_${ns}` });
};

afterAll(async () => {
  await closePgClient();
});

runConformance(makeStorage);
