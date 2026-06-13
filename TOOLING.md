# TOOLING.md — conventions (Epic 1, RATIFIED 2026-06-13)

**Ratified by Hilary.** Every `[RULE NEEDED]` below was ruled in favour of the recommendation.
This is now the governing tooling record for the Epic 2 scaffold; the scaffold obeys it.

Ratified rulings (2026-06-13):
- **Package manager:** pnpm workspaces.
- **Build + module output:** tsup → dual ESM + CJS + `.d.ts`.
- **Test runner:** Vitest.
- **Lint:** ESLint + typescript-eslint (skill-encoding ruleset, bans `console` in `src`).
- **Release/versioning:** Changesets (independent per-package).
- **`@/` alias:** dropped — relative intra-package, package-name inter-package imports.

Grounding: read from the deleted prior scaffold (`252e832`) + the style-input examples.
Prior stack = TS strict / CommonJS / `@/` alias · Prettier 120·2·double-quote · Jest+ts-jest ·
commitlint+commitizen+husky (conventional commits) · semantic-release → GitHub Packages
(`@hilaryosborne` scope) · deps Zod **v4**, nanoid v3.

---

## Settled by prior repo or PLAN (defaults — flag only to change)

- **Language:** TypeScript, `strict: true`. Derive types; avoid hand-written interfaces.
- **Validation:** Zod v4 (already a dep). nanoid for ids.
- **Format:** Prettier — `printWidth: 120`, `tabWidth: 2`, double quotes. Matches the skill.
- **Commits:** Conventional Commits, enforced by commitlint + husky (+ commitizen helper).
- **Publish target:** GitHub Packages, scope `@hilaryosborne`, `publishConfig.registry` per
  package (PLAN Epic 5). Note the documented consumer-auth friction stands.

---

## Decisions for you

### 1. Package manager + workspaces — **[RULE NEEDED]**
- **Recommend: pnpm workspaces.** Fast, strict (no phantom deps — good hygiene for a
  multi-package monorepo), first-class with Changesets. Prior repo used npm (single package).
- Alt: npm workspaces (one less tool; slower, looser).

### 2. Monorepo layout
- **Recommend:** `packages/*`, one publishable package each: `core`, `persistence`,
  `adapter-postgres`, `adapter-mongo`, `adapter-s3` (per PLAN Epics 2–4). Shared root config
  (tsconfig base, prettier, lint). Cross-package imports by package name, not `@/`.
- `@/` path alias was an app convention; in a library monorepo it doesn't publish cleanly.
  **Recommend** dropping `@/` for relative intra-package + package-name inter-package imports.
  **[RULE NEEDED]** if you want to keep an alias.

### 3. Build — **[RULE NEEDED]**
- **Recommend: tsup** (esbuild) per package → dual ESM+CJS + `.d.ts`, clean `dist/`. Low config,
  fast, ideal for many small packages.
- Alt: `tsc` project references (no extra dep; slower, CJS-only unless configured for dual).

### 4. Module format — **[RULE NEEDED]**
- **Recommend: dual ESM + CJS** output so consumers in either world just work. Prior was CJS
  (`target: ES6`). nanoid v3 stays CJS-safe; if we go ESM-only later, nanoid v5 is an option.
- Alt: stay CJS-only (simplest, but dated for a new public lib).

### 5. Test runner — **[RULE NEEDED]**
- **Recommend: Vitest.** ESM-native, fast, monorepo-friendly, Jest-compatible API. Pairs well
  with the adapter conformance suite (Epic 4) + Docker Compose.
- Alt: Jest + ts-jest (prior; heavier in ESM). Either way: `*.test.ts`, colocated, coverage on.

### 6. Lint — **[RULE NEEDED]**
- **Recommend: ESLint + typescript-eslint**, a deliberately small rule set that encodes the
  skill (no `console.*` in `src`, consistent imports, no unused). Prior repo had Prettier only;
  a lint rule banning `console.log` directly enforces the fix-on-sight list.
- Alt: Prettier-only (lighter; loses the console-ban guardrail).

### 7. Release / versioning — **[RULE NEEDED, recommend confirm]**
- **Recommend: Changesets.** PLAN Epic 5 mandates independent per-package versioning — when
  only one adapter changes, only it publishes. The prior `semantic-release` config is
  single-package/lockstep and won't give that. Changesets + a GH Actions publish job fits.
- Keep conventional commits for history/changelog; Changesets drives the actual version bumps.

---

## Naming conventions (carried from the coding-style skill, restated for scaffold)

- Files: dotted, lowercase, single-word segments, `.v1` on versioned artefacts.
- Packages: `@hilaryosborne/<name>` — `core`, `persistence`, `adapter-postgres`, …
- DSL primitives lowercase one word; exported definitions PascalCase+`V1`; locals camelCase.

---

## Open thread carried into the scaffold (not blocking)

- **DSL-across-sub-files with one top-level state** — captured in the skill (§10): entry file
  owns `state`, sub-files are `(state, ctx) => ({…})` method-group factories, entry composes.
  We prove this pattern out when the core DSL is built (Epic 3), not in the scaffold.
