# sourcing

A domain-agnostic **event sourcing** library, built as a monorepo of individually
publishable TypeScript packages. The library is mechanism, not judgment: it owns
events, aggregates, projections, and strippers — with no business logic and no
storage opinions.

> The consumer-facing, five-star README lands in Epic 6. This file is the
> contributor signpost for the scaffold.

## The mental model: bowl, cook, fridge

- **The aggregate is a bowl** — it holds events, keeping committed separate from
  staged. It does not know where events come from or go.
- **The persistence layer is the cook** — it fetches from storage, fills the bowl,
  reads the result, decides what to store. Lives outside core.
- **Storage is the fridge** — Postgres, Mongo, S3. The cook opens it; the bowl
  does not know it exists.

See **FOUNDATION.md** for the full conceptual model — it is the architecture.

## Packages

| Package                                    | Role                                                  |        |
| ------------------------------------------ | ----------------------------------------------------- | ------ |
| `@hilaryosborne/sourcing`                  | the bowl — events, aggregates, projections, strippers | Epic 3 |
| `@hilaryosborne/sourcing-persistence`      | the cook — registry, projection store, self-healing   | Epic 4 |
| `@hilaryosborne/sourcing-adapter-postgres` | a fridge — Postgres                                   | Epic 4 |
| `@hilaryosborne/sourcing-adapter-mongo`    | a fridge — Mongo                                      | Epic 4 |
| `@hilaryosborne/sourcing-adapter-s3`       | a fridge — S3 (the brutal one)                        | Epic 4 |

Core depends on nothing but Zod and nanoid. Persistence depends on core; core
never depends on it. Adapters implement the persistence storage interface.

## Toolchain

pnpm workspaces · tsup (dual ESM + CJS) · Vitest · ESLint + typescript-eslint ·
Prettier · Changesets (independent per-package versioning) · Conventional Commits
(commitlint + husky). See **TOOLING.md** for the ratified rulings.

```sh
pnpm install        # link the workspace
pnpm build          # build every package
pnpm typecheck      # type-check every package
pnpm test           # run the Vitest suite
pnpm lint           # ESLint
pnpm format         # Prettier --write
pnpm changeset      # record a version bump
```

## How this repo is built

Read in order: **CLAUDE.md** (how to behave here) → **FOUNDATION.md** (the model)
→ **DRAFT-AND-HALT.md** (the review protocol) → **PLAN.md** (the epics). Epics 3
and 4 design contracts behind a mandatory **HALT** gate: drafts are surfaced and
ratified before any implementation.
