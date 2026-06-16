# 🧯 Error index

The library makes one promise about failure: **every error it raises is mechanical.** A payload that doesn't match its schema, a version sequence that skips a number, a malformed mapper, a lost concurrency race. It will _never_ raise "insufficient funds" or "order already shipped" — business rules live in your code, so business errors are yours to throw. ([Why →](/guide/what-is-sourcing#mechanism-not-judgment))

That makes the full list of what the library _can_ throw finite, knowable, and worth keeping on one page. Every code below is a real enum member; the string in parentheses is the value you'll see at runtime (errors are thrown with that value as the message, so `err.message === EventErrors.PAYLOAD_INVALID` works).

::: tip The three you'll actually meet most

- **`STORAGE_VERSION_CONFLICT`** — _normal_, not a bug. Two writers raced; reload, re-stage, retry. ([pattern →](/guide/use-cases#two-writers-race-who-wins))
- **`PROJECTION_OUTPUT_INVALID`** — almost always a _shape gap_: your first folded event didn't establish the full read-model shape, or a handler dropped a required field. ([the contract →](/guide/projections))
- **`AGGREGATE_MISSING_CREATOR`** — you staged an event without calling `.creator(entity, uid)`. Provenance has no default, on purpose.
  :::

---

## Core — `EventErrors`

Thrown by the event builder and event instances. Import: `import { EventErrors } from "@hilaryosborne/sourcing"`.

| Code (string value)                                             | Thrown when                                                                                                                                | What to do                                                                                                                                                                   |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`PAYLOAD_INVALID`** (`EVENT_PAYLOAD_INVALID`)                 | `.create(payload)` is called with a payload that fails the head version's schema.                                                          | Fix the payload to match the schema. The underlying `ZodError` is on `err.cause`.                                                                                            |
| **`VERSION_SEQUENCE`** (`EVENT_VERSION_SEQUENCE`)               | `.version(n, …)` breaks the 1-based contiguous sequence — the first must be `1`, each later one exactly `previous + 1`.                    | Renumber your versions to run `1, 2, 3, …` with no gaps, duplicates, or wrong start.                                                                                         |
| **`UPCAST_ON_FIRST_VERSION`** (`EVENT_UPCAST_ON_FIRST_VERSION`) | `.upcast(…)` is called on version 1 — nothing precedes it to lift from.                                                                    | Remove the upcaster from version 1. Only versions ≥ 2 declare one.                                                                                                           |
| **`UPCAST_MISSING`** (`EVENT_UPCAST_MISSING`)                   | A version after the first was declared without an `.upcast(…)`. Checked lazily, at first use (`create` / `restore` / `consume` / `strip`). | Add the missing upcaster to that version. Every version ≥ 2 must lift the one before it.                                                                                     |
| **`UPCAST_INVALID`** (`EVENT_UPCAST_INVALID`)                   | An upcaster runs but its output fails _this_ version's schema while lifting a stored payload to head.                                      | Fix the upcaster so its return matches the version's schema. `err.cause` carries the `ZodError`.                                                                             |
| **`VERSION_UNKNOWN`** (`EVENT_VERSION_UNKNOWN`)                 | `.restore(envelope)` is given a stored `version` ordinal that isn't in the declared chain.                                                 | The event definition is missing the version that stored data was written at — declare it, or you're restoring against the wrong definition.                                  |
| **`STRIPPER_DUPLICATE`** (`EVENT_STRIPPER_DUPLICATE`)           | The same strip `context` (e.g. `"gdpr"`) is registered twice on one version.                                                               | Register each context once per version.                                                                                                                                      |
| **`STRIP_INVALID`** (`EVENT_STRIP_INVALID`)                     | A stripper runs but its redacted output fails that version's own schema.                                                                   | Make the stripper return a value that still satisfies the schema — e.g. `"[redacted]"` rather than dropping a required string. ([Right-to-forget →](/guide/right-to-forget)) |

---

## Core — `AggregateErrors`

Thrown by the aggregate definition and its `events` namespace. Import: `import { AggregateErrors } from "@hilaryosborne/sourcing"`.

| Code (string value)                                 | Thrown when                                                                                          | What to do                                                                                           |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **`TOPIC_DUPLICATE`** (`AGGREGATE_TOPIC_DUPLICATE`) | Two event definitions with the same topic are `.register()`ed on one aggregate.                      | A topic is unique _within_ an aggregate. Register each topic once.                                   |
| **`TOPIC_UNKNOWN`** (`AGGREGATE_TOPIC_UNKNOWN`)     | `events.add()` or `events.import()` handles an event whose topic isn't registered on this aggregate. | Register the event definition on the aggregate, or check you're staging onto the right aggregate.    |
| **`MISSING_CREATOR`** (`AGGREGATE_MISSING_CREATOR`) | `events.add(event)` is called on an event that has no creator set.                                   | Call `.creator(entity, uid)` on the event before adding it. Provenance is required, with no default. |
| **`EVENT_INVALID`** (`AGGREGATE_EVENT_INVALID`)     | `events.import(envelopes)` is given an envelope that fails schema validation on rehydration.         | The stored data is malformed for its definition. `err.cause` carries the `ZodError`.                 |

---

## Core — `ProjectionErrors`

Thrown by the projection builder and `build()`. Import: `import { ProjectionErrors } from "@hilaryosborne/sourcing"`.

| Code (string value)                                        | Thrown when                                                                                                | What to do                                                                                                                                                                                                                                          |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`OUTPUT_INVALID`** (`PROJECTION_OUTPUT_INVALID`)         | `build()` produces a state that fails the projection's output schema — validated on _every_ build.         | Almost always a shape gap: ensure the first folded event establishes the complete shape, and that every handler spreads `...current` so it never drops a required field. ([the contract →](/guide/projections)) `err.cause` carries the `ZodError`. |
| **`TOPIC_DUPLICATE`** (`PROJECTION_TOPIC_DUPLICATE`)       | Two `.handle()` mappers are registered for the same topic within one projection.                           | One mapper per topic per projection.                                                                                                                                                                                                                |
| **`MAPPER_INVALID`** (`PROJECTION_MAPPER_INVALID`)         | `.handle()` is called with a malformed registration — a missing event definition or a non-function mapper. | Pass a real `EventDefinition` and a `(state, event) => state` function.                                                                                                                                                                             |
| **`EVENT_UNREGISTERED`** (`PROJECTION_EVENT_UNREGISTERED`) | `.handle()` registers an event that isn't registered on the projection's bound aggregate.                  | Register the event on the aggregate (or bind the right aggregate with `.aggregate(...)`).                                                                                                                                                           |

---

## Persistence — `StorageErrors`

Raised by storage adapters at the port boundary. Import: `import { StorageErrors } from "@hilaryosborne/sourcing-persistence"`.

| Code (string value)                                                     | Thrown when                                                                                                                                                    | What to do                                                                                                                                                                                      |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`VERSION_CONFLICT`** (`STORAGE_VERSION_CONFLICT`)                     | `commit` / `append` runs under an expected-head guard that no longer matches — another writer advanced the stream first. **Nothing is written.**               | This is _expected and frequent_, not a fault. Reload the aggregate, re-stage your events, and retry. Filter it out of alerting sinks. ([pattern →](/guide/use-cases#two-writers-race-who-wins)) |
| **`APPEND_NOT_CONTIGUOUS`** (`STORAGE_APPEND_NOT_CONTIGUOUS`)           | An append's first event position isn't `expectedHead + 1`. Unlike a conflict, this is a _caller_ mistake, not a lost race.                                     | A code path is assigning positions wrong — let the aggregate stage events normally rather than hand-rolling positions.                                                                          |
| **`OVERWRITE_UNKNOWN_POSITION`** (`STORAGE_OVERWRITE_UNKNOWN_POSITION`) | `forget` / `overwrite` targets a `(stream, position)` that doesn't exist. The operation is all-or-nothing — if any position is missing, **none** are redacted. | Re-derive the positions from the actual stored stream before overwriting.                                                                                                                       |

---

## Persistence — `RepositoryErrors`

Raised by the repository. Import: `import { RepositoryErrors } from "@hilaryosborne/sourcing-persistence"`.

| Code (string value)                                                    | Thrown when                                                                                                                              | What to do                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`PROJECTION_AHEAD_OF_HEAD`** (`REPOSITORY_PROJECTION_AHEAD_OF_HEAD`) | `rebuild` finds a stored projection whose bookmark sits _at or past_ the stream head — it claims to have folded events that don't exist. | A corruption guard: `rebuild` refuses rather than silently healing. Bin the stored projection (it will rebuild clean) and investigate how the bookmark got ahead — usually events were deleted out from under a stored projection. |

---

## Persistence — `ReadModelErrors`

Raised by cross-stream read models. Import: `import { ReadModelErrors } from "@hilaryosborne/sourcing-persistence"`. ([Cross-stream read models →](/reference/api-persistence#cross-stream-read-models))

| Code (string value)                                 | Thrown when                                                                    | What to do                                                                                                    |
| --------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| **`OUTPUT_INVALID`** (`READMODEL_OUTPUT_INVALID`)   | A read model's folded state fails its output schema — validated on every fold. | Same shape discipline as projections: the `initial` seed plus every handler must keep the state schema-valid. |
| **`TOPIC_DUPLICATE`** (`READMODEL_TOPIC_DUPLICATE`) | Two `.on()` handlers are registered for the same topic within one read model.  | One handler per topic per read model.                                                                         |
| **`MAPPER_INVALID`** (`READMODEL_MAPPER_INVALID`)   | `.on()` is called with a missing event definition or a non-function handler.   | Pass a real `EventDefinition` and a `(state, event) => state` function.                                       |

---

## How to handle them

Errors are thrown with the enum value as the message, so compare against the enum rather than matching strings by hand:

```ts
import { ProjectionErrors } from "@hilaryosborne/sourcing";
import { StorageErrors } from "@hilaryosborne/sourcing-persistence";

try {
  await repo.commit(account);
} catch (err) {
  if (err instanceof Error && err.message === StorageErrors.VERSION_CONFLICT) {
    // expected — reload, re-stage, retry
  } else {
    throw err; // anything else is a real fault
  }
}
```

Where an error wraps an underlying validation failure (`PAYLOAD_INVALID`, `OUTPUT_INVALID`, `EVENT_INVALID`, `UPCAST_INVALID`, `STRIP_INVALID`), the original `ZodError` is preserved on `err.cause` so you can surface the exact field that failed.

## ➡️ Next

- [Data model reference](/reference/data-models) — the shapes these errors validate against.
- [FAQ & edge cases](/faq) — the gotchas behind the most common ones.
- [API: core](/reference/api-core) · [API: persistence](/reference/api-persistence) — where each error is raised.
