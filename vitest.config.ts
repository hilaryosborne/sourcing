import { defineConfig } from "vitest/config";

// One root runner across every package. Tests are colocated as `*.test.ts`
// beside the code they prove (see the `testing` skill). Coverage is on by
// default tooling; thresholds are tightened per package as real code lands.
export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts"],
    // passWithNoTests so a freshly-scaffolded package doesn't fail the run before its
    // tests land; the real-service conformance suites run from their own config.
    passWithNoTests: true,
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.ts"],
      exclude: ["**/*.test.ts", "**/__tests__/**", "**/index.ts"],
    },
  },
});
