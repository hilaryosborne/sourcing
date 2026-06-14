// Conformance run config — the real-adapter suites live under conformance/, outside the
// packages/*/src tree the unit-test config scans. Run from the repo root:
//   npx vitest run -c conformance/vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: process.cwd(),
  test: {
    include: ["conformance/**/*.conformance.test.ts"],
    // Real services + Docker: give each suite room and don't parallelize across backends.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
