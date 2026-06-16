# 📦 Installation & setup

Everything you need to get the packages installed — including the one-time GitHub Packages auth — and, if you're going to use storage, a local Postgres/Mongo/S3 to develop against. In a hurry and only need the in-memory core? The [Quickstart](/guide/getting-started) has the two-line version.

## Requirements

- **Node.js 18+** and an **ESM** project. The packages are published as ES modules (`"type": "module"`); in a CommonJS project, import them from ESM or use a bundler.
- **Zod** as a peer — the schema library the API is built on. You install it alongside the core.
- **TypeScript 5+** recommended (the DSL is fully typed), though plain JavaScript works too.

## Install the core

The core is everything you need to define events and fold projections — no database required:

```sh
npm install @hilaryosborne/sourcing zod
```

It depends on exactly two packages (`zod`, `nanoid`) and touches no storage.

## Add storage (optional)

Reach for the repository and an adapter only when you want events _persisted_ and projections kept current for you. Install the persistence layer plus **one** adapter:

::: code-group

```sh [Postgres]
npm install @hilaryosborne/sourcing-persistence @hilaryosborne/sourcing-adapter-postgres
```

```sh [Mongo]
npm install @hilaryosborne/sourcing-persistence @hilaryosborne/sourcing-adapter-mongo
```

```sh [S3]
npm install @hilaryosborne/sourcing-persistence @hilaryosborne/sourcing-adapter-s3
```

:::

Each adapter is independently versioned — change one adapter, only it publishes. You pick exactly one adapter per repository; spreading streams across stores is your plumbing, not the library's. ([Architecture →](/guide/architecture))

## GitHub Packages auth (one-time)

These packages publish to **GitHub Packages**, which requires authentication to install — even though they're public. This is a cost of GitHub Packages, not of the library. Add a project-level `.npmrc`:

```ini
@hilaryosborne:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

Then export a token with the `read:packages` scope:

```sh
export GITHUB_TOKEN=ghp_your_personal_access_token
```

::: details Troubleshooting auth

- **`401 Unauthorized` / `403 Forbidden`** — the token is missing, expired, or lacks `read:packages`. Regenerate a [personal access token](https://github.com/settings/tokens) with that scope and re-export it.
- **`404 Not Found` on a `@hilaryosborne/*` package** — npm isn't routing the scope to GitHub. Confirm the `@hilaryosborne:registry` line is in the `.npmrc` npm is actually reading (project root, not just your home dir).
- **CI** — set `GITHUB_TOKEN` as a secret; in GitHub Actions the built-in `secrets.GITHUB_TOKEN` already has `read:packages`.
  :::

## The package map

| Package                                    | Install when you want to…                                                     |
| ------------------------------------------ | ----------------------------------------------------------------------------- |
| `@hilaryosborne/sourcing`                  | Define events, aggregates, projections, and strippers — the in-memory core.   |
| `@hilaryosborne/sourcing-persistence`      | Store events and get self-healing projections, forget, and the observer seam. |
| `@hilaryosborne/sourcing-adapter-postgres` | Persist to PostgreSQL (relational, cheap deltas).                             |
| `@hilaryosborne/sourcing-adapter-mongo`    | Persist to MongoDB (document store; needs a replica set).                     |
| `@hilaryosborne/sourcing-adapter-s3`       | Persist to S3 / any S3-compatible object store.                               |

## Local databases for development

The core needs none of this — but to run the storage examples locally, the repo ships a Docker Compose file with all three backends (the same services the adapters are certified against):

```sh
# from the repo root
docker compose -f conformance/docker-compose.yml up -d postgres   # :5433
docker compose -f conformance/docker-compose.yml up -d mongo       # :27019 (replica set)
docker compose -f conformance/docker-compose.yml up -d minio       # :9100 (S3-compatible)
```

Or a minimal standalone Postgres to develop against:

```yaml
# docker-compose.yml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: postgres
    ports:
      - "5432:5432"
```

::: warning Mongo needs a replica set
The Mongo adapter runs multi-event appends in a transaction, and Mongo has no single-statement multi-document atomic write — so it needs a replica set (even single-node). A standalone `mongod` will fail at commit. The Compose service above starts one with `--replSet rs0`; initiate it once with `rs.initiate()` and connect with `directConnection=true`. ([Mongo adapter →](/guide/storage-adapters))
:::

The adapters create their own tables/collections/indexes on first use (idempotently), so there's no migration step to run — point an adapter at a database and go.

## ➡️ Next

- [Quickstart](/guide/getting-started) — build and fold your first projection.
- [Architecture at a glance](/guide/architecture) — how the packages fit together.
- [Storage adapters](/guide/storage-adapters) — wire up Postgres, Mongo, or S3.
