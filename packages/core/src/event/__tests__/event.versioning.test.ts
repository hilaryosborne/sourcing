// Epic 8 — event versioning & upcasters (ref-exact DSL). Proves the read-time evolution
// model end to end: the upcast chain composes to head, build() stays faithful to the stored
// version, strip is version-local + re-validated, and the three version invariants are
// RUNTIME-validated mechanical faults (not compile-time guarantees). Ordinals are the
// declared 1-based contiguous version numbers. FOUNDATION §"Versions & upcasters".
import { describe, it, expect } from "vitest";
import { object, string } from "zod";
import event from "../event";
import aggregate from "../../aggregate/aggregate";
import projection from "../../projection/projection";
import { EventErrors } from "../event.errors";
import { EventEnvelopeV1 } from "../event.schema";

// --- A three-version event: holder string → { name } + country → { name, id } + country ---
const v1 = object({ holder: string().min(1) });
const v2 = object({ holder: object({ name: string().min(1) }), country: string().min(1) });
const v3 = object({ holder: object({ name: string().min(1), id: string().min(1) }), country: string().min(1) });

// The upcast input is `unknown` (the handle does not thread the previous output type), so a
// consumer narrows it — here against the schema it knows precedes this version.
type V1 = { holder: string };
type V2 = { holder: { name: string }; country: string };
type Head = { holder: { name: string; id: string }; country: string };

// Captured const, configured per version off it (registration is the call's side effect).
const buildHeadDef = () => {
  const AccountOpened = event("account.opened");
  AccountOpened.version(1, v1).strip("gdpr", () => ({ holder: "[redacted]" }));
  AccountOpened.version(2, v2).upcast((e) => {
    const prev = e as V1;
    return { holder: { name: prev.holder }, country: "unknown" };
  });
  AccountOpened.version(3, v3)
    .upcast((e) => {
      const prev = e as V2;
      return { holder: { name: prev.holder.name, id: "legacy" }, country: prev.country };
    })
    .strip("gdpr", (p) => ({ holder: { name: "[redacted]", id: p.holder.id }, country: p.country }));
  return AccountOpened;
};

// A genuinely OLD persisted event: written when only v1 existed (ordinal 1), via a def that
// declared a single version. This is what an evolved def must read forward.
const storedV1Envelope = () => {
  const v1Only = event("account.opened");
  v1Only.version(1, v1);
  const agg = aggregate("account.v1").register(v1Only);
  const seed = agg.instance("acc-1");
  seed.events.add(v1Only.create({ holder: "Alice" }).creator("user", "u1"));
  return seed.events.export()[0]!;
};

describe("event versioning — upcast on read", () => {
  it("create() mints at head; get.payload() is the head shape", () => {
    const AccountOpened = buildHeadDef();
    const instance = AccountOpened.create({ holder: { name: "Bob", id: "u9" }, country: "US" });
    expect(instance.get.version()).toBe(3); // head ordinal (1-based)
    expect(instance.get.payload()).toEqual({ holder: { name: "Bob", id: "u9" }, country: "US" });
  });

  it("restore() lifts an old v1 event all the way to head, preserving the stored ordinal", () => {
    const AccountOpened = buildHeadDef();
    const restored = AccountOpened.restore(storedV1Envelope());
    // Consumer sees head: v1 → v2 (country "unknown") → v3 (id "legacy").
    expect(restored.get.payload()).toEqual({ holder: { name: "Alice", id: "legacy" }, country: "unknown" });
    expect(restored.get.version()).toBe(1); // still stored at its origin version
  });

  it("build() is faithful to the stored version — never the upcast result", () => {
    const AccountOpened = buildHeadDef();
    const restored = AccountOpened.restore(storedV1Envelope());
    const envelope = restored.build();
    expect(envelope.version).toBe(1);
    expect(envelope.payload).toEqual({ holder: "Alice" }); // stored v1 shape, untouched
  });

  it("a mixed-version stream projects uniformly at head", () => {
    const AccountOpened = buildHeadDef();
    const agg = aggregate("account.v1").register(AccountOpened);
    const headEvent = AccountOpened.create({ holder: { name: "Bob", id: "u9" }, country: "US" })
      .creator("user", "u1")
      .stage({ id: "acc-1", name: "account.v1" }, 1)
      .build();
    const instance = agg.instance("acc-1");
    instance.events.import([storedV1Envelope(), headEvent]); // ordinal 1 and ordinal 3 side by side

    const Names = projection("projection.names.v1", object({ names: string() }));
    Names.aggregate(agg);
    Names.handle<Head>(AccountOpened, (current, e) => ({
      names: current.names ? `${current.names},${e.payload.holder.name}` : e.payload.holder.name,
    }));
    expect(Names.build(instance)).toEqual({ names: "Alice,Bob" }); // both seen at head
  });
});

describe("event versioning — strip is version-local and re-validated", () => {
  it("strips an old v1 event with its OWN version's stripper, at the stored shape", () => {
    const AccountOpened = buildHeadDef();
    const stripped = AccountOpened.restore(storedV1Envelope()).strip("gdpr");
    expect(stripped.build().payload).toEqual({ holder: "[redacted]" }); // redacted in v1 vocabulary
    expect(stripped.get.version()).toBe(1);
    // …and it still upcasts to a head-valid shape afterward (the chains decouple).
    expect(stripped.get.payload()).toEqual({ holder: { name: "[redacted]", id: "legacy" }, country: "unknown" });
  });

  it("rejects a stripper whose output breaks its own version's schema (STRIP_INVALID)", () => {
    const Bad = event("x.v1");
    Bad.version(1, v1).strip("bad", () => ({ holder: "" })); // "" fails min(1)
    const evt = Bad.create({ holder: "Alice" });
    expect(() => evt.strip("bad")).toThrow(EventErrors.STRIP_INVALID);
  });
});

describe("event versioning — mechanical faults", () => {
  it("a malformed upcaster surfaces as UPCAST_INVALID on read", () => {
    const Broken = event("y.v1");
    Broken.version(1, v1);
    // upcast returns a shape that fails v2's schema (country missing)
    Broken.version(2, v2).upcast((e) => ({ holder: { name: (e as V1).holder } }) as unknown as V2);
    const env = (() => {
      const v1Only = event("y.v1");
      v1Only.version(1, v1);
      const agg = aggregate("y.v1").register(v1Only);
      const seed = agg.instance("y-1");
      seed.events.add(v1Only.create({ holder: "Zoe" }).creator("user", "u1"));
      return seed.events.export()[0]!;
    })();
    expect(() => Broken.restore(env).get.payload()).toThrow(EventErrors.UPCAST_INVALID);
  });

  it("a stored ordinal the chain does not declare is VERSION_UNKNOWN", () => {
    const AccountOpened = buildHeadDef();
    const future = EventEnvelopeV1.parse({
      ...storedV1Envelope(),
      version: 7, // beyond the 3-version chain
    });
    expect(() => AccountOpened.restore(future)).toThrow(EventErrors.VERSION_UNKNOWN);
  });
});

describe("event versioning — runtime invariants (the three version rules)", () => {
  it("the first version cannot declare an upcast (UPCAST_ON_FIRST_VERSION)", () => {
    const v1Only = event("z.v1").version(1, v1);
    expect(() => v1Only.upcast((e) => e as V1)).toThrow(EventErrors.UPCAST_ON_FIRST_VERSION);
  });

  it("a version number that breaks the contiguous-from-1 sequence is VERSION_SEQUENCE", () => {
    expect(() => event("z1.v1").version(2, v1)).toThrow(EventErrors.VERSION_SEQUENCE); // first must be 1
    const gap = event("z2.v1");
    gap.version(1, v1);
    expect(() => gap.version(3, v2)).toThrow(EventErrors.VERSION_SEQUENCE); // gap
    const dup = event("z3.v1");
    dup.version(1, v1);
    expect(() => dup.version(1, v2)).toThrow(EventErrors.VERSION_SEQUENCE); // duplicate / out of order
  });

  it("a later version left without an upcast is unusable (UPCAST_MISSING at first use)", () => {
    const def = event("z4.v1");
    def.version(1, v1);
    def.version(2, v2); // no upcast declared
    expect(() => def.create({ holder: { name: "a" }, country: "US" })).toThrow(EventErrors.UPCAST_MISSING);
  });
});
