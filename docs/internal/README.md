# Internal docs — how this library was built

These are the **build-process documents**: the architecture-of-record and the working discipline behind `@hilaryosborne/sourcing`. They are not needed to _use_ the library — for that, read the [README](../../README.md), the [docs site](https://hilaryosborne.github.io/sourcing/), or the consumer skills under [`docs/skills/`](../skills/). They live here, out of the public root, so the repo's front door stays consumer-facing; nothing is lost, and the full history remains in git.

| Document | What it is |
| --- | --- |
| [FOUNDATION.md](./FOUNDATION.md) | The conceptual model and the rulings that define the library. The architecture-of-record — the _why_ behind every decision. |
| [PLAN.md](./PLAN.md) | The epic-by-epic build plan, dependencies, and gates. |
| [DRAFT-AND-HALT.md](./DRAFT-AND-HALT.md) | The review protocol for design artefacts — design in drafts, halt, ratify, then build. |
| [TOOLING.md](./TOOLING.md) | The ratified tooling and convention decisions (pnpm, tsup, Vitest, ESLint, Prettier, Changesets). |
| [REFINEMENTS.md](./REFINEMENTS.md) | The adoption-readiness backlog — the tech-lead questions for production use, with gaps and directions, prioritised. |

The agent operating manual for this repository is [`.claude/CLAUDE.md`](../../.claude/CLAUDE.md); the development style skills are under [`.claude/skills/`](../../.claude/skills/).
