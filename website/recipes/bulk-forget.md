# 🗑️ Bulk & operational right-to-forget

`repository.forget` erases **one** stream. Real erasure requests — "delete everything for this user/tenant" — span many streams, and erasure is compliance, so _completion_ matters more than speed. This recipe covers doing it at scale, correctly.

## Forget is per-stream; bulk is a loop

A subject's data is a set of streams under a known id scheme ([Multi-tenant →](/recipes/multi-tenant)). Bulk erasure iterates them:

```ts
async function forgetSubject(streams: { aggregate: AggregateDefinition; id: string }[]) {
  for (const { aggregate, id } of streams) {
    await forgetWithRetry(aggregate, id, "gdpr");
  }
}
```

## Completion is an operational obligation

`forget` is **idempotent and convergent under retry**, but **not atomic** across its steps (load → strip → overwrite → bin). If it fails _after_ overwrite but _before_ binning, PII can linger in a stale "current" projection. So the unit of correctness is _completion_, not a single call — retry until it succeeds:

```ts
async function forgetWithRetry(aggregate: AggregateDefinition, id: string, context: string, attempts = 5) {
  for (let attempt = 1; ; attempt++) {
    try {
      await repo.forget({ aggregate, id, context });
      return; // converged
    } catch (err) {
      if (attempt >= attempts) throw err; // surface it — an unfinished forget is a compliance gap
      await backoff(attempt);
    }
  }
}
```

Re-running from the top heals any partial-failure state: stripping an already-redacted payload is identity-preserving, overwriting redacted-over-redacted is a no-op, and binning deletes whatever projection is cached.

## Don't forget the cross-stream read models

`repository.forget` bins the _stream's own_ projections — but a [cross-stream read model](/guide/read-models) isn't stream-bound, so the repository **can't** bin it for you. If any read model derived data from the erased streams, you must `rebuild` it afterwards (it re-folds the now-redacted feed, purging the PII):

```ts
await forgetSubject(subjectStreams);
await processor({ feed, store }).rebuild(CustomerSearchIndex); // purge the firehose-derived view too
```

This is the one part bulk erasure can't skip — and it's your obligation, exactly like `forget`'s own "re-run until done."

## Watch it happen

Wire an [observer](/guide/write-own-observer) and `forget`'s progress hook reports each stage — `loaded` → `stripped` → `overwritten` → `binned` — so you can prove, per stream, that erasure reached `binned`:

```ts
hook: (e) => {
  if (e.op === "forget" && e.phase === "progress") metrics.increment(`forget.${e.step}`);
  if (e.op === "forget" && e.phase === "success") audit.record({ stream: e.stream?.id, erased: true });
};
```

## Scheduling

For large subjects, run the loop as a resumable background job: persist which stream ids are done, throttle to avoid hammering the store, and let the idempotency above make re-runs safe. A crash mid-batch costs nothing but a replay.

## ➡️ Next

- [Right-to-forget](/guide/right-to-forget) — the erase sequence and its guarantees.
- [The repository & self-healing](/guide/repository#right-to-forget-the-forget-sequence) — the per-stream steps.
- [Cross-stream read models](/guide/read-models) — why `rebuild` is the purge path.
