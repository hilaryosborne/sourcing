// Epic 8 — event versioning & upcasters. Proves the read-time evolution model end to end:
// the upcast chain composes to head, build() stays faithful to the stored version, strip is
// version-local + re-validated, and the three type-state guarantees hold at compile time
// (the @ts-expect-error / expectTypeOf lines are checked by `tsc`, and the absent-method
// calls also throw at runtime). FOUNDATION §"Versions & upcasters".
import { describe, it, expect, expectTypeOf } from "vitest";
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

const buildHeadDef = () =>
  event("account.opened")
    .version(v1)
    .strip("gdpr", () => ({ holder: "[redacted]" }))
    .version(v2)
    .upcast((e) => ({ holder: { name: e.holder }, country: "unknown" }))
    .version(v3)
    .upcast((e) => ({ holder: { name: e.holder.name, id: "legacy" }, country: e.country }))
    .strip("gdpr", (p) => ({ holder: { name: "[redacted]", id: p.holder.id }, country: p.country }));

// A genuinely OLD persisted event: written when only v1 existed (ordinal 0), via a def that
// declared a single version. This is what an evolved def must read forward.
const storedV1Envelope = () => {
  const v1Only = event("account.opened").version(v1);
  const agg = aggregate("account.v1").register(v1Only);
  const seed = agg.instance("acc-1");
  seed.events.add(v1Only.create({ holder: "Alice" }).creator("user", "u1"));
  return seed.events.export()[0]!;
};

describe("event versioning — upcast on read", () => {
  it("create() mints at head; get.payload() is the head shape", () => {
    const AccountOpened = buildHeadDef();
    const instance = AccountOpened.create({ holder: { name: "Bob", id: "u9" }, country: "US" });
    expect(instance.get.version()).toBe(2); // head ordinal
    expect(instance.get.payload()).toEqual({ holder: { name: "Bob", id: "u9" }, country: "US" });
  });

  it("restore() lifts an old v1 event all the way to head, preserving the stored ordinal", () => {
    const AccountOpened = buildHeadDef();
    const restored = AccountOpened.restore(storedV1Envelope());
    // Consumer sees head: v1 → v2 (country "unknown") → v3 (id "legacy").
    expect(restored.get.payload()).toEqual({ holder: { name: "Alice", id: "legacy" }, country: "unknown" });
    expect(restored.get.version()).toBe(0); // still stored at its origin version
  });

  it("build() is faithful to the stored version — never the upcast result", () => {
    const AccountOpened = buildHeadDef();
    const restored = AccountOpened.restore(storedV1Envelope());
    const envelope = restored.build();
    expect(envelope.version).toBe(0);
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
    instance.events.import([storedV1Envelope(), headEvent]); // ordinal 0 and ordinal 2 side by side

    const Names = projection("projection.names.v1", object({ names: string() }));
    Names.aggregate(agg);
    Names.handle(AccountOpened, (current, e) => ({
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
    expect(stripped.get.version()).toBe(0);
    // …and it still upcasts to a head-valid shape afterward (the chains decouple).
    expect(stripped.get.payload()).toEqual({ holder: { name: "[redacted]", id: "legacy" }, country: "unknown" });
  });

  it("rejects a stripper whose output breaks its own version's schema (STRIP_INVALID)", () => {
    const Bad = event("x.v1")
      .version(v1)
      .strip("bad", () => ({ holder: "" })); // "" fails min(1)
    const evt = Bad.create({ holder: "Alice" });
    expect(() => evt.strip("bad")).toThrow(EventErrors.STRIP_INVALID);
  });
});

describe("event versioning — mechanical faults", () => {
  it("a malformed upcaster surfaces as UPCAST_INVALID on read", () => {
    const Broken = event("y.v1")
      .version(v1)
      // upcast returns a shape that fails v2's schema (country missing)
      .version(v2)
      .upcast((e) => ({ holder: { name: e.holder } }) as unknown as { holder: { name: string }; country: string });
    const env = (() => {
      const v1Only = event("y.v1").version(v1);
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

describe("event versioning — type-state guarantees (compile-time + runtime)", () => {
  it("the first version cannot declare an upcast", () => {
    const def = event("z.v1").version(v1);
    // @ts-expect-error first version has no .upcast (nothing precedes it)
    expect(() => def.upcast((e) => e)).toThrow();
  });

  it("a later version must upcast before the definition is usable", () => {
    const pending = event("z.v1").version(v1).version(v2);
    // @ts-expect-error .create is absent on a pending (un-upcast) version
    expect(() => pending.create({ holder: { name: "a" }, country: "US" })).toThrow();
  });

  it("an upcast's input IS the previous version's output", () => {
    event("z.v1")
      .version(v1)
      .version(v2)
      .upcast((e) => {
        expectTypeOf(e).toEqualTypeOf<{ holder: string }>(); // v1 output, not v2
        return { holder: { name: e.holder }, country: "US" };
      });
  });
});
