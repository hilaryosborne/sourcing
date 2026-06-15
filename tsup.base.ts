import type { Options } from "tsup";

// Shared build preset for every publishable package: dual ESM + CJS output
// with type declarations, so consumers in either module world just work
// (docs/internal/TOOLING.md). Each package spreads this and points `entry` at
// its own barrel.
export const base: Options = {
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
};
