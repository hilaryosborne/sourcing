# 📦 Order fulfillment

An order is not a row that mutates from `placed` to `paid` to `shipped`. It is a **sequence of facts** that happened, in order, and never un-happened. Event sourcing models that natively — and this page is the whole lifecycle, built up one runnable step at a time.

By the end you will have the payoff every fulfillment system eventually wants: a hard guarantee that **you cannot ship an order that hasn't been paid** — enforced in _your_ code, on a would-be state the library computes for you, with the aggregate keeping its hands clean.

## 🧾 The facts an order produces

Five things can happen to an order. Each is a topic (opaque, versioned string) and a Zod payload. Nothing more.

```ts
import { event } from "@hilaryosborne/sourcing";
import { object, string, number, array } from "zod";

export const OrderPlaced = event("order.placed");
OrderPlaced.version(
  1,
  object({
    items: array(object({ sku: string().min(1), qty: number().int().positive() })).min(1),
    total: number().int().positive(),
  }),
);

export const OrderPaid = event("order.paid");
OrderPaid.version(1, object({ amount: number().int().positive() }));
export const OrderShipped = event("order.shipped");
OrderShipped.version(1, object({ carrier: string().min(1), tracking: string().min(1) }));
export const OrderDelivered = event("order.delivered");
OrderDelivered.version(1, object({}));
export const OrderCancelled = event("order.cancelled");
OrderCancelled.version(1, object({ reason: string().min(1) }));
```

`create()` validates the payload the instant you build a fact — a `total` of `0` throws `EventErrors.PAYLOAD_INVALID` right there, never half-formed downstream. When a payload shape needs to change, add a `.version(n, …)` + `.upcast()` to the event: stored facts are lifted to the latest shape at read, the version rules are enforced as runtime mechanical errors, and nothing is rewritten on disk. ([How versioning works →](/guide/events#versions-upcasters-evolving-a-payload))

## 🧱 The aggregate: a faithful container, not a rulebook

The aggregate `order` declares which topics are _legal_ on an order's stream. It enforces **no business rules** — it will happily stage a `shipped` before a `paid` if you ask it to. That freedom is exactly what makes the guard later _yours_.

```ts
import { aggregate } from "@hilaryosborne/sourcing";

export const Order = aggregate("order");
Order.register(OrderPlaced);
Order.register(OrderPaid);
Order.register(OrderShipped);
Order.register(OrderDelivered);
Order.register(OrderCancelled);
```

That is the entire container. No state machine, no allowed-transitions table, no consistency boundary. The aggregate remembers facts in order; it does not judge them.

## 📊 The read model: status that advances with the stream

Here is the lifecycle made legible — an order-status projection. The **creating event establishes the full shape**; every other handler spreads `...current` and changes only what it owns.

```ts
import { projection } from "@hilaryosborne/sourcing";
import { object, string, number, boolean, optional } from "zod";

const OrderStatusSchema = object({
  status: string(), // "placed" | "paid" | "shipped" | "delivered" | "cancelled"
  total: number(),
  paid: boolean(),
  tracking: optional(string()),
});

export const OrderStatus = projection("order-status", OrderStatusSchema);
OrderStatus.aggregate(Order);

// The creating event seeds EVERY required field — this is the load-bearing rule.
OrderStatus.handle<{ total: number }>(OrderPlaced, (current, e) => ({
  ...current,
  status: "placed",
  total: e.payload.total,
  paid: false,
}));

OrderStatus.handle(OrderPaid, (current) => ({ ...current, status: "paid", paid: true }));
OrderStatus.handle<{ tracking: string }>(OrderShipped, (current, e) => ({
  ...current,
  status: "shipped",
  tracking: e.payload.tracking,
}));
OrderStatus.handle(OrderDelivered, (current) => ({ ...current, status: "delivered" }));
OrderStatus.handle(OrderCancelled, (current) => ({ ...current, status: "cancelled" }));
```

`e.payload` is typed where we annotate the handler — `e.payload.total` on `placed`, `e.payload.tracking` on `shipped` — and runtime-validated against each event's schema regardless. Each handler advances `status` by one step. The whole lifecycle is right there, readable top to bottom.

::: tip Why the first handler is special
Handlers receive a _complete_ `current: State`, not a `Partial` — that is what lets you write `current.total` without `| undefined` noise. You uphold it by making `order.placed` return the full base. If the first folded event were a non-creating one, `build` would throw `ProjectionErrors.OUTPUT_INVALID` — a gap the types can't catch. Every stream starts with its `placed`; every other handler spreads `...current`.
:::

## 🚚 Drive the happy path

No database, nothing to configure — fold the facts in memory and watch `status` walk forward.

```ts
const order = Order.instance(); // core mints a nanoid id; pass your own to override

order.events.add(OrderPlaced.create({ items: [{ sku: "BOOK-1", qty: 2 }], total: 4000 }).creator("user", "ada"));
order.events.add(OrderPaid.create({ amount: 4000 }).creator("user", "ada"));
order.events.commit();

OrderStatus.build(order);
// → { status: "paid", total: 4000, paid: true, tracking: undefined }

order.events.add(OrderShipped.create({ carrier: "Royal Mail", tracking: "RM123" }).creator("system", "wms"));
order.events.add(OrderDelivered.create({}).creator("system", "wms"));
order.events.commit();

OrderStatus.build(order);
// → { status: "delivered", total: 4000, paid: true, tracking: "RM123" }
```

`creator` is required on every fact — a permanent record with no provenance refuses to exist. `commit()` here is in-memory bookkeeping that folds staged events into committed history; core stores nothing.

## 🛡️ The payoff: refuse to ship an unpaid order

The library has no opinion on lifecycle order. So how do you stop a `shipped` landing on an order that was never paid? You **stage the event without committing**, build the _would-be_ status, and judge it — in plain code you can read.

```ts
function ship(order, carrier, tracking) {
  // Stage the proposed fact — provisional, NOT committed.
  order.events.add(OrderShipped.create({ carrier, tracking }).creator("system", "wms"));

  // Ask the library: what WOULD the status be if this shipped?
  const wouldBe = OrderStatus.build(order); // folds committed ++ staged

  if (wouldBe.paid !== true) {
    // YOUR rule. Reject — never commit. The staged shipment evaporates.
    throw new Error(`cannot ship: order is "${wouldBe.status}", not paid`);
  }

  order.events.commit(); // allowed — fold staged → committed
  return wouldBe;
}
```

Run it against an order that was placed but never paid:

```ts
const unpaid = Order.instance();
unpaid.events.add(OrderPlaced.create({ items: [{ sku: "BOOK-1", qty: 1 }], total: 2000 }).creator("user", "ada"));
unpaid.events.commit();

ship(unpaid, "Royal Mail", "RM999"); // throws: cannot ship: order is "placed", not paid
unpaid.events.committed.length; // still 1 — the staged shipment evaporated, history untouched
```

Read that `if` again: the rule lives in your code, exactly where you can see and test it. There is no decider, no command bus, no transition table to misconfigure. The library answered _"what would the status be?"_; your app answered _"is this allowed?"_. The aggregate enforced nothing — and that is the design, not a gap in it.

## 🧭 The stream IS the order history

You did not build an audit log alongside the order. The order **is** its audit log. `export()` hands you every fact, in position order, as plain validated envelopes.

```ts
order.events.export();
// [
//   { topic: "order.placed",    payload: { items: [...], total: 4000 }, creator: { entity: "user",   uid: "ada" }, position: 0, ... },
//   { topic: "order.paid",      payload: { amount: 4000 },              creator: { entity: "user",   uid: "ada" }, position: 1, ... },
//   { topic: "order.shipped",   payload: { carrier: "Royal Mail", tracking: "RM123" }, creator: { entity: "system", uid: "wms" }, position: 2, ... },
//   { topic: "order.delivered", payload: {},                            creator: { entity: "system", uid: "wms" }, position: 3, ... },
// ]
```

Who placed it, who paid it, which system shipped it, when each happened — it is all in the stream because it always was. "What's the status?" is a projection you fold on demand. "What happened?" is the events themselves. You never chose between them.

## What you just saw

- **An event stream models a process over time natively** — five facts (`placed → paid → shipped → delivered`, or `cancelled`) are the order's whole life, never a mutated row.
- **The aggregate is a faithful container, not a rulebook.** `order` enforces no lifecycle order; it remembers facts and stamps positions, nothing more.
- **A projection turns the stream into a status read model**, the creating event seeding the shape and each handler advancing `status` by one step — with `e.payload` typed where the handler is annotated and runtime-validated throughout.
- **Staged validation is where lifecycle rules live — in your code.** Stage `shipped`, build the would-be status, reject if `paid !== true`, and the unwanted fact evaporates. The library previews; you decide.
- **The stream is the audit trail** — `export()` is the complete, provenanced order history, for free.

Next:

- [Aggregates](/guide/aggregates) — the committed/staged split that makes staged validation possible.
- [Shopping cart](/examples/shopping-cart) — the same primitives on an add/remove/checkout flow.
