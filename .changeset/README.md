# Changesets

This folder holds [changesets](https://github.com/changesets/changesets) — one
markdown file per pending change describing which packages bump and how. Run
`pnpm changeset` to add one; `pnpm version` consumes them into version bumps and
changelogs; `pnpm release` publishes.

Versioning is **independent per package** (docs/internal/TOOLING.md, PLAN Epic 5): when only
one adapter changes, only it publishes. Do not bump packages in lockstep.
