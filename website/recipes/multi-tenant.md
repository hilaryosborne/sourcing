# 🏘️ Multi-tenant & sharding by stream

A stream is addressed by `(aggregate name, id)`. That pair is the natural unit of tenant isolation and sharding — get the id scheme right and multi-tenancy mostly falls out.

## Isolate tenants in the stream id

The simplest, most robust approach: make the tenant part of the aggregate id, so every stream is unambiguously owned by one tenant.

```ts
const streamId = (tenantId: string, orderId: string) => `${tenantId}:${orderId}`;

const order = await repo.create(Order); // or repo.load(Order, streamId(tenant, id))
```

Because adapters key everything by `(name, id)`, two tenants' streams never collide, never interleave, and a `load`/`rebuild`/`forget` for one tenant can't touch another's. Put the tenant in the [`creator`](/reference/data-models#creatorschemav1-provenance) too (`creator("tenant", tenantId)`) so provenance records _who_, not just _what_.

::: tip Don't fold across tenants by accident
A single-stream [projection](/guide/projections) only ever sees one stream, so it's tenant-safe by construction. The place to be careful is a [cross-stream read model](/guide/read-models) — it folds the _firehose_, so key its rows by tenant and filter deliberately if a view should be per-tenant.
:::

## Shard by routing to destinations or adapters

The library targets **one adapter per repository** and never coordinates across stores — so sharding is _your_ routing in front of it, which is exactly where it belongs. Two levers:

- **Different [destinations](/guide/destinations) per tenant tier** — point a tenant's events/projections at different tables or prefixes within one backend.
- **Different adapters per shard** — compose a repository per shard and route by tenant:

```ts
const repos = new Map<string, RepositoryI>(); // shardKey → repository

function repoFor(tenantId: string): RepositoryI {
  const shard = shardKeyFor(tenantId); // your hashing / lookup
  return repos.get(shard)!; // a repository over that shard's adapter
}

await repoFor(tenant).commit(order);
```

Each repository still enforces optimistic concurrency and right-to-forget on its own streams; what you're composing is _placement_, not a distributed transaction. Cross-shard consistency, if you need it, lives in your routing layer — the library's honest line is non-prohibition, not coordination. ([Spreading storage →](/guide/destinations))

## Per-tenant erasure

Because a tenant's data is a set of streams under a known id scheme, [right-to-forget](/guide/right-to-forget) for a tenant is a loop over their stream ids — see [Bulk & operational right-to-forget](/recipes/bulk-forget).

## ➡️ Next

- [Spreading storage](/guide/destinations) — destinations and the one-adapter rule.
- [Cross-stream read models](/guide/read-models) — when a view must span tenants.
- [Bulk right-to-forget](/recipes/bulk-forget) — erasing a tenant's streams.
