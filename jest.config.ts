import { createDefaultPreset } from "ts-jest";

const tsJestTransformCfg = createDefaultPreset().transform;

/** @type {import("jest").Config} **/
module.exports = {
  testEnvironment: "node",
  transform: {
    ...tsJestTransformCfg,
  },
  preset: "ts-jest",
  testMatch: ["**/__tests__/**/*.test.ts", "**/*.test.ts"],
  // coverage configuration
  collectCoverage: false,
  coverageDirectory: ".coverage",
  collectCoverageFrom: [
    "src/**/*.{ts,tsx}",
    "!src/**/*.d.ts",
    "!src/**/*.test.ts",
    "!src/__stubs__/**",
    "!src/__mocks__/**",
    "!src/**/__tests__/**",
    "!src/index.ts",
  ],
  coverageReporters: ["text", "json-summary", "json"],
};
