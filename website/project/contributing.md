# 🤝 Contributing

Contributions are welcome — code, docs, adapters, examples, or just a sharp issue. This page is the practical guide to working in the repo. The guiding principle is the same one the library is built on: **mechanism, not judgment, proven by tests.** Nothing is done until it's demonstrably correct.

## Prerequisites

- **Node.js 18+** and **[pnpm](https://pnpm.io)** (the repo pins a version via `packageManager`; [corepack](https://nodejs.org/api/corepack.html) will use it automatically).
- **Docker** — only if you're working on a storage adapter (the conformance suite runs against real Postgres / Mongo / MinIO).

## Get set up

```sh
git clone https://github.com/hilaryosborne/sourcing.git
cd sourcing
pnpm install        # installs the whole workspace (core, persistence, adapters, website)
pnpm build          # build every package
pnpm test           # run the unit suites
```

## The common tasks

| Command                                                  | What it does                                                         |
| -------------------------------------------------------- | -------------------------------------------------------------------- |
| `pnpm build`                                             | Build all packages (`pnpm -r build`).                                |
| `pnpm typecheck`                                         | Type-check every package, then the root.                             |
| `pnpm test`                                              | Run the unit test suites (Vitest).                                   |
| `pnpm test:watch`                                        | Vitest in watch mode.                                                |
| `pnpm test:conformance`                                  | Build, then run the adapter conformance suite against real services. |
| `pnpm lint` / `pnpm format`                              | ESLint / Prettier.                                                   |
| `pnpm --filter @hilaryosborne/sourcing-website docs:dev` | Run this docs site locally.                                          |

## Testing an adapter (conformance)

Every storage adapter — the shipped three and any you contribute — must pass the same [conformance suite](/reference/api-persistence#conformance). Bring the services up first:

```sh
docker compose -f conformance/docker-compose.yml up -d postgres mongo minio
pnpm test:conformance
```

The suite asserts only **contract facts** (head advances, conflicts write nothing, overwrite is all-or-nothing, hostile keys round-trip, concurrent appends resolve to one winner) — it never branches on adapter type. If your adapter passes it, it behaves like the official ones. See [Write your own storage adapter](/guide/write-own-adapter).

## The bar (definition of done)

- **Tests are part of done.** New behaviour ships with tests; an adapter ships conformance-green. ([Testing recipe →](/recipes/testing))
- **Only mechanical errors.** The core never encodes business rules — keep judgment in the consumer's hands.
- **Match the house style.** Read a couple of neighbouring files; mirror their naming, comment density, and construction. Run `pnpm format` and `pnpm lint` before pushing.

## Proposing a change

1. Branch from `main`.
2. Make the change, with tests, lint- and type-clean.
3. **Add a changeset** — the repo uses [Changesets](https://github.com/changesets/changesets) for versioning and the changelog:
   ```sh
   pnpm changeset   # pick the affected packages + bump level, describe the change
   ```
   Each package is versioned independently, so a change to one adapter only bumps that adapter.
4. Open a pull request. Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `feat!:` for breaking).

## Contributing to these docs

The site is [VitePress](https://vitepress.dev) under `website/`. Edit the Markdown, run the dev server, and make sure the build is clean — it **fails on dead links and bad anchors**, which is your safety net:

```sh
pnpm --filter @hilaryosborne/sourcing-website docs:build
```

Match the voice: honest about trade-offs, every code block real (runs as-is or clearly a fragment), edge cases named and shown handled, a "Next" block at the end.

## License

The project is **MIT-licensed**. By contributing, you agree your contributions are licensed under the same terms.
