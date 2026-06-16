// Right-to-forget × cross-stream read models — the sharpest open question, closed end to end.
// It demonstrates BOTH the trap and the fix:
//   1. after a forget, the FEED reflects the redaction (so a rebuild can't re-fold the original PII);
//   2. a plain catchUp does NOT heal an already-folded read model (it only folds new events) — the trap;
//   3. processor.rebuild() re-folds the whole redacted feed and purges the PII — the fix.
import { describe, it, expect } from "vitest";
import { object, number, record, string } from "zod";
import { event, aggregate } from "@hilaryosborne/sourcing";
import { repository } from "../../repository/repository";
import { readModel } from "../../read-model/read-model";
import { processor } from "../processor";
import { memoryReadSide } from "../../__tests__/memory-readside";

const PII = "ada@example.com";

const OrderPlaced = event("order.placed.v1").version(
  object({ customer: string().min(1), email: string().min(1), total: number().int().nonnegative() }),
);
OrderPlaced.strip("gdpr", (payload) => ({ ...payload, email: "[redacted]", customer: "[redacted]" }));

const Order = aggregate("order.v1");
Order.register(OrderPlaced);

// A cross-stream read model that DERIVES the PII into its own state (keyed by order id).
const OrdersV1 = object({ rows: record(string(), object({ email: string(), total: number() })) });
const makeOrders = () =>
  readModel("readmodel.orders.v1", OrdersV1, { rows: {} }).on(OrderPlaced, (state, e) => ({
    rows: { ...state.rows, [e.aggregate.id]: { email: e.payload.email, total: e.payload.total } },
  }));

const seeded = async () => {
  const storage = memoryReadSide();
  const repo = repository({ storage });
  const proc = processor({ feed: storage, store: storage });
  const order = await repo.create(Order);
  order.events.add(OrderPlaced.create({ customer: "Ada", email: PII, total: 100 }).creator("user", "ada"));
  await repo.commit(order);
  return { storage, repo, proc, id: order.id };
};

describe("right-to-forget × cross-stream read models", () => {
  it("the FEED reflects the in-place redaction — a rebuild can't re-fold the original PII", async () => {
    const { storage, repo, id } = await seeded();
    await repo.forget({ aggregate: Order, id, context: "gdpr" });

    const page = await storage.readFeed(undefined, 100);
    const dump = JSON.stringify(page.entries);
    expect(dump).not.toContain(PII); // the feed serves the redacted event, not the original
    expect(dump).toContain("[redacted]");
  });

  it("THE TRAP: a stale read model still holds PII after forget — catchUp alone does not heal it", async () => {
    const { repo, proc, id } = await seeded();
    const before = await proc.catchUp(makeOrders()); // folds the order — read model now holds the email
    expect(before.rows[id]!.email).toBe(PII);

    await repo.forget({ aggregate: Order, id, context: "gdpr" });
    const afterCatchUp = await proc.catchUp(makeOrders()); // only folds NEW events (none)

    // The PII is STILL in the cross-stream read model — this is exactly why a rebuild is required.
    expect(JSON.stringify(afterCatchUp)).toContain(PII);
  });

  it("THE FIX: processor.rebuild() re-folds the redacted feed and purges the PII", async () => {
    const { repo, proc, id } = await seeded();
    await proc.catchUp(makeOrders()); // read model holds the PII
    await repo.forget({ aggregate: Order, id, context: "gdpr" });

    const healed = await proc.rebuild(makeOrders()); // re-fold the whole, now-redacted, feed

    expect(JSON.stringify(healed)).not.toContain(PII);
    expect(healed.rows[id]!.email).toBe("[redacted]");
  });

  it("rebuild leaves a clean checkpoint — a following catchUp is a no-op that keeps the PII gone", async () => {
    const { repo, proc, id } = await seeded();
    await proc.catchUp(makeOrders());
    await repo.forget({ aggregate: Order, id, context: "gdpr" });
    await proc.rebuild(makeOrders());

    const afterRebuild = await proc.catchUp(makeOrders());
    expect(JSON.stringify(afterRebuild)).not.toContain(PII);
    expect(afterRebuild.rows[id]!.email).toBe("[redacted]");
  });
});
