---
name: testing
description: >-
  How to test in this repository — the create/test/prove standard, test layout, mocking
  strategy (msw for HTTP, __mocks__/__stubs__), what to construct vs mock, and the
  event-sourcing invariants worth proving. Use when writing tests, setting up test
  infrastructure, deciding test boundaries, or building a conformance suite for adapters.
  Assumes the `coding-style` foundation. Tests are part of done — but only AFTER the relevant
  contract is ratified (Epic 3/4 gates, docs/internal/DRAFT-AND-HALT.md).
---

# testing — create, test, prove

The project standard is **create, test, prove**: a thing isn't done until it exists, is tested,
and is demonstrably provable (a passing suite, a worked example, or both). Tests come **after**
the relevant interface is ratified — never write tests against an unratified shape.

> Scope honesty: the HTTP/integration guidance below (msw, mocks, stubs) is grounded in real
> prior code. The guidance for testing the **pure event-sourcing core** (reducers, aggregates,
> projections, strippers) is *principle-led* — no mature example of it exists yet. The concrete
> patterns get established in **Epic 3's prove phase**, and this skill should be refined from the
> first real core tests we write there. Treat the core-testing sections as a sound starting
> intent, not a finished convention.

---

## Layout & runner

- **Jest + ts-jest.** Tests are `*.test.ts`, colocated in a `__tests__/` (or `__test__/`) folder
  beside the unit. `testMatch` covers `**/__tests__/**/*.test.ts` and `**/*.test.ts`.
- **Coverage excludes non-source:** `!**/*.test.ts`, `!**/__tests__/**`, `!src/__mocks__/**`,
  `!src/__stubs__/**`, `!src/**/*.d.ts`, `!src/index.ts`. Coverage is opt-in (`--coverage`).
- One behaviour per `it`, **named for the behaviour** (`"should only log error messages"`), not
  for the method. `describe` per unit. `beforeEach`/`afterEach` keep each test isolated.

---

## What to construct, what to mock

- **Construct, don't mock, what's cheap to build.** Real events, in-memory aggregates, real
  schema instances — build them. This is why the domain core is pure and the IO lives at the
  edge (foundation §10): the interesting things are constructable without a backend.
- **Reserve test doubles for the IO shell** — storage, transport, third-party HTTP. Mock at the
  boundary, not inside your own logic.
- **Test through the public surface** — the DSL/contract a consumer uses — not private internals.
  If a unit can only be tested by reaching inside, it's doing too much (foundation §6); split it.

---

## Mocking HTTP — msw, with a lifecycle

External HTTP is mocked with **msw (Mock Service Worker)**, wired once via a setup file:

```ts
// src/__mocks__/server.ts
export const server = setupServer(...handlers);

// jest.setup.ts
beforeAll(() => server.listen({ onUnhandledRequest: "warn" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

- `__mocks__/handlers.ts` holds the msw request handlers; `__mocks__/server.ts` is the server.
- Module-level mocks (e.g. the fetch client) go in `__mocks__/` and are wired with jest
  `moduleNameMapper`.
- **`__stubs__/` holds fixtures captured from real responses** — a real vendor payload saved as a
  default-exported object, so tests map against reality, not a guess.

---

## Spying — e.g. a logger

For a console-backed logger, spy on `console` and assert level filtering; restore after each:

```ts
beforeEach(() => { spy = { error: jest.spyOn(console, "error").mockImplementation(() => {}), /* … */ }; });
afterEach(() => jest.restoreAllMocks());

it("should only log error messages", () => {
  new LoggerConsole({ level: "error" }).warn("nope");
  expect(spy.warn).not.toHaveBeenCalled();
});
```

---

## Prove the things that actually matter

- **The mechanical-error paths, on purpose.** A bad payload rejects; a malformed mapper throws; a
  topic collision is caught. Those are the *only* errors the core promises — they're the ones
  worth proving.
- **Replay determinism** (foundation §11): the same events fold to the identical read-model every
  time. Build, rebuild, assert equal.
- **The stripper pass/fail test:** after stripping, walk the produced events and assert **no PII
  survives** — same identity, redacted payload.
- **Adapter conformance:** a single shared suite every storage adapter must pass against its
  **real** service (Postgres/Mongo/S3 via Docker Compose). One suite, three backends — proving the
  port holds (Epic 4). Don't let an adapter "pass" against a mock of itself.

---

## Rehearse the release

Before publishing, rehearse publish/install against a **local registry (verdaccio, via Docker
Compose)** so a broken `exports`/`files`/types map is caught before it ships, not after
(Epic 5).

---

## Fix-on-sight (test smells)

- **Placeholder tests** (`expect(true).toBe(true)`, "can instantiate" only) standing in for real
  coverage — thin coverage masquerading as done. Name the gap; don't let it read as proven.
- **Duplicate `it()` names** — copy-paste; each test asserts one distinct behaviour.
- **Mocking your own logic** instead of the IO boundary — you end up testing the mock.
- **Tests reaching into privates** — a signal the unit is too big (foundation §6).
