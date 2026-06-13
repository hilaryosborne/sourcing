import { defineConfig } from "vitest/config";

// One root runner across every package. Tests are colocated as `*.test.ts`
// beside the code they prove (see the `testing` skill). Coverage is on by
// default tooling; thresholds are tightened per package as real code lands.
export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts"],
    // No tests yet — they land post-ratification in Epic 3/4 (DRAFT-AND-HALT.md).
    passWithNoTests: true,
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.ts"],
      exclude: ["**/*.test.ts", "**/index.ts"],
    },
  },
});
