import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

// A deliberately small ruleset that encodes the coding-style skill: no stray
// console in shipped code, no unused bindings, consistent type-only imports.
// Formatting is Prettier's job and intentionally absent here.
export default tseslint.config(
  { ignores: ["**/dist/**", "**/coverage/**", "**/node_modules/**"] },
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
);
