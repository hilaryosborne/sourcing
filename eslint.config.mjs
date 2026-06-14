import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

// A deliberately small ruleset that encodes the coding-style skill: no stray
// console in shipped code, no unused bindings, consistent type-only imports.
// Formatting is Prettier's job and intentionally absent here.
export default tseslint.config(
  // ref/ holds prior example libraries kept purely for illustration (git-ignored,
  // never shipped). It is not ours to lint — exclude it like build output.
  { ignores: ["**/dist/**", "**/coverage/**", "**/node_modules/**", "ref/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      "no-console": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
  {
    // Tests may narrate to the console and lean on test-runner globals.
    files: ["**/*.test.ts"],
    rules: { "no-console": "off" },
  },
  {
    // conformance/ holds Phase D test infrastructure + dev probes against real services;
    // console output is their purpose, not stray logging in shipped code.
    files: ["conformance/**"],
    rules: { "no-console": "off" },
  },
);
