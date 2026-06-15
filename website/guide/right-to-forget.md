# Right-to-forget

Immutable history and "delete my data" sound like fire and water. The library reconciles them with **stripping**: each event declares named, contextual redactions next to itself (only the event understands its own payload), and erasure rewrites the affected events _in place_ with redacted payloads — same id, position, topic, and metadata, new payload. Nothing is mutated where it sits; a new redacted version replaces the old fact.

```ts
AccountOpened.strip("gdpr", (payload) => ({ ...payload, holder: "[redacted]" }));
```

Pure-core, erasure is `strip → export`, and the pass/fail test is blunt — **no PII survives in the produced events**:

```ts
const redacted = account.strip("gdpr"); // a NEW aggregate; events with no matching stripper pass through
redacted.events.export(); // PII-free envelopes
```

With storage, the repository owns the whole sharp-edged sequence as one operation:

```ts
await repo.forget({ aggregate: Account, id, context: "gdpr" });
// load the full stream → strip(context) → overwrite events in place → bin every projection for the stream
```

Binning projections is load-bearing, not housekeeping: in-place redaction doesn't move the stream head, so a cached "current" projection would still serve the old PII. Deleting it forces a clean rebuild from the redacted events.

::: warning Completion is an operational obligation
`forget` is idempotent and convergent, but **not atomic**. If it fails after overwriting events but before binning projections, PII can linger in a cached projection. Re-run it until it succeeds — re-running is always safe (stripping a redacted payload is a no-op). For a compliance operation, treat completion as required, not best-effort.
:::

The library appends **no** "redaction happened" marker. If you want an erasure audit trail, emit your own event — that's a business fact, and business facts are yours.

## Why observability can't undo this

Because the erase mechanism is so careful, it would be a shame to leak the PII straight back out through your logs. It can't: the [observability seam](/guide/observability) is **metadata-only by type** — hook and log payloads are constrained to primitives, so an event payload can't be emitted. You can strip the event store; you could never strip Splunk, so the library makes sure nothing sensitive gets there in the first place.
