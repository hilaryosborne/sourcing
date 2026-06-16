# 🗑️ Right-to-forget (GDPR erasure)

"Immutable history" and "delete my data" sound like fire and water. An event store records facts that happened and never un-happened — and then a data subject exercises their right to erasure, and the law expects the PII to be _gone_.

This page is the reconciliation, built one runnable step at a time. We model a user account that holds real PII, and by the end you will have done the hardest thing an event store is asked to do: **erased the personal data while keeping the history's shape intact** — same ids, same positions, same topics, same provenance — and proved, with a blunt pass/fail test, that no PII survives. Then we will do it again against a real store, and watch the next rebuild heal clean.

## 🧾 The facts a user produces

Two things happen to a user. One carries PII; one does not. Each is a topic (opaque, versioned string) and a Zod payload — nothing more.

```ts
import { event } from "@hilaryosborne/sourcing";
import { object, string } from "zod";

// The creating event. `email` and `fullName` are the PII — this is what erasure must reach.
export const UserRegistered = event("user.registered");
const userRegisteredV1 = UserRegistered.version(
  1,
  object({
    email: string().email(),
    fullName: string().min(1),
    handle: string().min(1),
  }),
);

// A later fact. `handle` is a public display name — NOT PII. It must survive erasure untouched.
export const UserRenamed = event("user.renamed");
UserRenamed.version(1, object({ handle: string().min(1) }));
```

`create()` validates the payload the instant you build a fact — a malformed `email` throws `EventErrors.PAYLOAD_INVALID` right there, never half-formed downstream.

## ✂️ Strippers — the redaction lives with the event

Only the event understands its own payload, so the redaction belongs next to the definition, not in some central erasure service that has to know every schema. A stripper is a **pure** function: payload in, redacted payload out.

```ts
// Registered on the PII-bearing version (the builder its `.version(1, …)` returned).
// Named so you can have several contexts.
userRegisteredV1.strip("gdpr", (payload) => ({
  ...payload,
  email: "[redacted]",
  fullName: "[redacted]",
  // handle is deliberately left intact — it is not personal data.
}));
```

- `strip(context, fn)` registers a **named** stripper on that version's builder and returns it, so it chains. You can register several (`"gdpr"`, `"support-view"`, …); each is its own redaction. The stripper's input/output are typed to that version's schema.
- We register **nothing** on `user.renamed`. Events with no matching stripper pass through untouched — that is how `handle` survives while `email` and `fullName` do not.

::: warning The test of a correct stripper is blunt
No PII survives the produced payload. Return a **new** object; never mutate the input. Registering two strippers under one context name on one version throws `EventErrors.STRIPPER_DUPLICATE`.
:::

## 🧱 The aggregate and the read model

The aggregate `user` declares which topics are legal on a user's stream. It enforces no business rules — it is a faithful container.

```ts
import { aggregate, projection } from "@hilaryosborne/sourcing";

export const User = aggregate("user");
User.register(UserRegistered);
User.register(UserRenamed);
```

A profile read model — the thing your app actually renders. The **creating event seeds the full shape**; the rename handler spreads `...current` and changes only what it owns.

```ts
const ProfileSchema = object({ email: string(), handle: string() });

export const Profile = projection("profile", ProfileSchema);
Profile.aggregate(User);

// The creating event establishes EVERY required field — the load-bearing rule.
Profile.handle<{ email: string; handle: string }>(UserRegistered, (current, e) => ({
  ...current,
  email: e.payload.email,
  handle: e.payload.handle,
}));

Profile.handle<{ handle: string }>(UserRenamed, (current, e) => ({ ...current, handle: e.payload.handle }));
```

`e.payload` is typed where we annotate the handler (`handle<P>`) — `e.payload.email` on registration, `e.payload.handle` on rename — and runtime-validated against each event's schema regardless.

## 🧬 Path one — pure core: `strip` → `export`

No database, nothing to configure. Build a user's history in memory, then erase it. This is the whole mechanism with nothing else in the way.

```ts
const user = User.instance(); // core mints a nanoid id; pass your own to override

user.events.add(
  UserRegistered.create({ email: "ada@example.com", fullName: "Ada Lovelace", handle: "ada" }).creator("user", "ada"),
);
user.events.add(UserRenamed.create({ handle: "countess" }).creator("user", "ada"));
user.events.commit();
```

The data subject asks to be forgotten. In pure core, erasure is exactly two calls:

```ts
const redacted = user.strip("gdpr"); // a NEW aggregate instance — `user` is untouched
const envelopes = redacted.events.export(); // committed ++ staged, in position order, redacted
```

`strip(context)` walks every event, applies each event's matching named stripper, and returns a **new** aggregate — same ids, positions, topics, creators, timestamps; redacted payloads. Here is what `export()` hands back:

```ts
// [
//   {
//     topic: "user.registered",
//     payload: { email: "[redacted]", fullName: "[redacted]", handle: "ada" }, // PII gone; handle kept
//     creator: { entity: "user", uid: "ada" },
//     position: 0,
//     id: "…", created: "…",          // ← IDENTICAL to the pre-strip event
//   },
//   {
//     topic: "user.renamed",
//     payload: { handle: "countess" }, // no stripper registered → passed through untouched
//     creator: { entity: "user", uid: "ada" },
//     position: 1,
//     id: "…", created: "…",
//   },
// ]
```

The history's _shape_ is preserved perfectly — every id, position, topic, and provenance field is the one it always was. Only the personal data changed. The stream still folds into a valid profile; it just no longer contains a name or an email.

And the pass/fail test that makes this a compliance operation and not a hope — assert that **no PII survives**:

```ts
const serialized = JSON.stringify(envelopes);
serialized.includes("ada@example.com"); // false
serialized.includes("Ada Lovelace"); // false
serialized.includes("countess"); // true  — handle is not PII; it survives by design
```

If the email or full name appeared anywhere in `serialized`, the stripper was wrong. They do not. That is the test, and it is the one worth writing.

## 💾 Path two — persisted: `repo.forget(...)`

In memory, `strip → export` is the whole story. Against a real store there is more to do — the stored events must be overwritten and any cached projection must not keep serving the old name. The repository owns that whole sharp-edged sequence as **one operation**, so you never hand-roll it.

```ts
import { repository } from "@hilaryosborne/sourcing-persistence";

const repo = repository({ storage }); // storage is a StorageI from any adapter (Postgres / Mongo / S3)

// …the user was registered, renamed, and committed through the repository earlier…

await repo.forget({ aggregate: User, id, context: "gdpr" });
```

That single call does, in order:

1. **Load** the full stream from storage.
2. **`strip(context)`** — apply the named strippers (the same `"gdpr"` redaction from above).
3. **Overwrite the events in place** — same `(stream, position)`, new redacted payload. The head does not move.
4. **Bin every projection** for the stream.

Step 4 is load-bearing, not housekeeping. In-place redaction does not advance the stream head, so a cached "current" profile would happily keep serving `Ada Lovelace`. Deleting it forces the **next read to rebuild from the redacted events** — and the rebuild heals clean:

```ts
const profile = await repo.rebuild({ aggregate: User, id, projection: Profile });
// → { email: "[redacted]", handle: "countess" }
```

The library appends **no** "a redaction happened" marker — that would be a business fact, and business facts are yours to emit. If you want an erasure audit trail, raise your own event.

::: warning Completion is an operational obligation
`forget` is idempotent and convergent, but **not atomic** across its steps. If it fails after overwriting events but before binning projections, PII can linger in a cached projection. **Re-run it until it succeeds** — re-running is always safe, because stripping an already-redacted payload is a no-op. For a compliance operation, treat completion as _required_, not best-effort.
:::

## 🛰️ Why observability can't leak the PII back out

You did this careful work to erase the event store. It would be a quiet disaster if the same PII had already been copied into Splunk or New Relic through your telemetry — because you can strip your own store, but you can never strip your vendor's.

It can't have. The [observability seam](/guide/observability) is **metadata-only by type, not by discipline**. The data an observer may emit is `Record<string, string | number | boolean | undefined>` — primitives only. An event payload cannot be nested into a log line or a hook, because the _type_ forbids it. There is no code review to forget and no convention to break: the leak is unrepresentable.

So the guarantee composes cleanly. You can wire the repository into your platform for full operational visibility — latencies, conflict rates, the self-healing cache-hit ratio — and `forget` still means what it says, because nothing sensitive ever reached the telemetry backend in the first place.

## ⚖️ Why in-place rewrite, and not the alternatives

A tech lead will have heard of two other answers. Both are legitimate; neither is this library's choice, and it is worth being honest about why.

- **Tombstoning** — append a "this event is forgotten" marker and teach every reader to skip it. The PII is still sitting in the store; you have only promised not to look. That is not erasure, it is a curtain.
- **Crypto-shredding** — encrypt each subject's events under a per-subject key, then throw the key away to render them unreadable. It works, but it buys erasure with permanent key-management machinery, ciphertext you can never project over again, and a dependency on a cipher staying unbroken.

This library overwrites the events **in place**: the personal data is genuinely replaced with redacted data, the history keeps its exact shape, and the stream still folds into valid projections afterward. No marker to honour, no key vault to babysit, no ciphertext — just facts whose PII is gone and whose structure is intact.

## What you just saw

- **Erasure and immutability are reconciled by _stripping_** — named, pure redactions declared next to each event, because only the event understands its own payload.
- **Pure core erasure is `strip → export`**, and the pass/fail test is blunt: no PII survives the produced envelopes. `strip` returns a **new** aggregate with ids, positions, topics, and provenance preserved and only the payload redacted; the non-PII `handle` passes through untouched.
- **`repo.forget({ aggregate, id, context })` owns the persisted sequence** — load → strip → overwrite in place → bin projections — and the next `rebuild` heals clean. Completion is an operational obligation: idempotent, convergent, re-run until done.
- **Observability cannot defeat `forget`** — the observer is metadata-only _by type_, so payloads were never emittable. You can strip your store precisely because nothing sensitive ever reached Splunk.
- **In-place rewrite is the deliberate choice** over tombstoning (a curtain, not erasure) and crypto-shredding (erasure bought with permanent key machinery).

Next:

- [Right-to-forget](/guide/right-to-forget) — the mechanism in full, including why no redaction marker is appended.
- [Observability](/guide/observability) — the metadata-only seam, and why it makes PII leakage unrepresentable.
