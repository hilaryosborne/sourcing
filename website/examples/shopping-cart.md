# 🛒 Shopping cart

A cart is the friendliest place to meet event sourcing: every click is already an event. _Item added. Item removed. Checked out._ You don't model a cart's _state_ — you record what happened to it and fold the facts into a view when you need one.

This page builds one cart, end to end, in pure in-memory core. No database, nothing to configure — every block runs as-is and builds on the one before it. The payoff at the bottom is the library's signature move: **stage a checkout, ask "what would the state be?", and let _your_ code decide whether to allow it.** The library never learns your rule.

## 📦 Install

```sh
npm install @hilaryosborne/sourcing zod
```

That's everything. Persistence is a separate, optional layer — you won't need it to run a single line below.

## 🧾 The events

A cart's whole life is four facts. Each event is a **topic** (an opaque, versioned string) plus a **Zod payload schema** — and `create()` validates the payload the instant you build one.

```ts
import { event } from "@hilaryosborne/sourcing";
import { object, string, number } from "zod";

const CartOpened = event("cart.opened");
CartOpened.version(1, object({ shopper: string().min(1) }));
const ItemAdded = event("cart.item-added");
ItemAdded.version(
  1,
  object({
    sku: string().min(1),
    qty: number().int().positive(),
    price: number().int().nonnegative(), // minor units (pennies) — integers, no float drift
  }),
);
const ItemRemoved = event("cart.item-removed");
ItemRemoved.version(1, object({ sku: string().min(1) }));
const CheckedOut = event("cart.checked-out");
CheckedOut.version(1, object({}));
```

The topic is yours to name. When `cart.item-added`'s payload shape needs to change, add a `.version(n, …)` + `.upcast()` so old events lift to the latest shape at read — the version rules are enforced as runtime mechanical errors, and nothing is rewritten on disk. ([How versioning works →](/guide/events#versions-upcasters-evolving-a-payload))

## 🛍️ The aggregate

An aggregate is an in-memory container for one cart's event stream. Name it, then declare which topics are legal on it.

```ts
import { aggregate } from "@hilaryosborne/sourcing";

const Cart = aggregate("cart");
Cart.register(CartOpened);
Cart.register(ItemAdded);
Cart.register(ItemRemoved);
Cart.register(CheckedOut);
```

The aggregate enforces **no business rules** — it's a faithful container, not a consistency boundary. It won't stop you removing an item that isn't there or checking out an empty cart. Those are _your_ rules, and they live in your code, not buried in here.

## 🧮 The projection

Now fold the facts into a read model. A projection is a name, an output schema (the shape you want to read), and one handler per event. `build()` runs the handlers over the cart's events and validates the result against the schema on **every** build.

```ts
import { projection } from "@hilaryosborne/sourcing";
import { object, string, number, record } from "zod";

const CartSummarySchema = object({
  shopper: string(),
  items: record(string(), number()), // sku → qty
  lineCount: number(), // distinct skus
  subtotal: number(), // minor units
});

const CartSummary = projection("cart", CartSummarySchema);
CartSummary.aggregate(Cart); // bind the aggregate this projection reads

// The CREATING event establishes the WHOLE shape — every field the schema requires.
CartSummary.handle<{ shopper: string }>(CartOpened, (current, e) => ({
  ...current,
  shopper: e.payload.shopper,
  items: {},
  lineCount: 0,
  subtotal: 0,
}));

// Every other handler spreads ...current and changes only what it owns.
CartSummary.handle<{ sku: string; qty: number; price: number }>(ItemAdded, (current, e) => {
  const items = { ...current.items, [e.payload.sku]: (current.items[e.payload.sku] ?? 0) + e.payload.qty };
  return {
    ...current,
    items,
    lineCount: Object.keys(items).length,
    subtotal: current.subtotal + e.payload.qty * e.payload.price,
  };
});

CartSummary.handle<{ sku: string }>(ItemRemoved, (current, e) => {
  const { [e.payload.sku]: _gone, ...items } = current.items;
  return { ...current, items, lineCount: Object.keys(items).length };
});
```

Notice `e.payload` is typed inside each handler because we annotate it — `handle<P>` keys off the event _definition_, not a topic string, so `e.payload.sku` and `e.payload.price` are typed and runtime-validated against the schema. (And we simply don't handle `CheckedOut` in the summary — unmapped topics are tolerated; `build` folds what it has handlers for and skips the rest.)

::: warning The first folded event establishes the shape
Handlers receive a _complete_ `current: State`, never a `Partial` — that's what lets you write `current.subtotal` without `| undefined` everywhere. You uphold the bargain by making your **creating event** (`cart.opened`) return every required field. If the first folded event were a non-creating one, the model would be missing fields and `build` throws `ProjectionErrors.OUTPUT_INVALID` — a runtime error the types can't catch. Rule of thumb: every stream opens with `*.opened`; every other handler spreads `...current`.
:::

## 🧺 Fill the cart and read it

Mint an instance, stage some facts, commit, and fold. Note `creator` — it's **required**: a permanent fact with no provenance refuses to be created.

```ts
const cart = Cart.instance(); // core mints a nanoid id; pass your own to override

cart.events.add(CartOpened.create({ shopper: "Ada" }).creator("user", "ada"));
cart.events.add(ItemAdded.create({ sku: "BOOK-01", qty: 1, price: 1299 }).creator("user", "ada"));
cart.events.add(ItemAdded.create({ sku: "MUG-07", qty: 2, price: 850 }).creator("user", "ada"));
cart.events.commit(); // fold staged → committed (in-memory bookkeeping; core stores nothing)

CartSummary.build(cart);
// → { shopper: "Ada",
//     items: { "BOOK-01": 1, "MUG-07": 2 },
//     lineCount: 2,
//     subtotal: 2999 }
```

Change your mind — same fact stream, just another event:

```ts
cart.events.add(ItemRemoved.create({ sku: "MUG-07" }).creator("user", "ada"));
cart.events.commit();

CartSummary.build(cart);
// → { shopper: "Ada", items: { "BOOK-01": 1 }, lineCount: 1, subtotal: 1299 }
```

## 🎯 The payoff — staged validation

Here is the move the whole library is shaped around. You want a rule: **no checking out an empty cart, and no checking out above a £500 limit.** The library has no concept of either. So you don't tell it your rule — you ask it a question.

Stage the checkout **without committing**, build the would-be summary, and judge it yourself:

```ts
// A shopper hits "Checkout". Stage the fact — but don't commit it yet.
cart.events.add(CheckedOut.create({}).creator("user", "ada"));

const wouldBe = CartSummary.build(cart); // folds committed ++ staged → the cart AS IF checked out

// Your rules. The library has no opinion on either of these.
const LIMIT = 50000; // £500 in pennies

if (wouldBe.lineCount === 0) {
  // empty cart — reject. Never commit. The staged checkout evaporates.
  throw new Error("Cannot check out an empty cart");
} else if (wouldBe.subtotal > LIMIT) {
  // over the limit — reject. The cart is untouched; the staged fact is dropped.
  throw new Error(`Cart subtotal ${wouldBe.subtotal} exceeds the ${LIMIT} limit`);
} else {
  cart.events.commit(); // allowed — make it durable history
}
```

That's it. No decider, no command bus, no rule engine to wire up. The library answered _"what would the state be?"_; your `if` statement answered _"is this allowed?"_ — and you can read both in one screenful.

::: tip Why stage instead of just doing the math?
You _could_ eyeball `subtotal` before adding the checkout event. But by staging the real fact and building the real projection, your rule runs against the **exact would-be state** the system commits — the same fold, the same schema validation, no parallel "preview" logic to drift out of sync. Reject, and the staged event simply never becomes history.
:::

## What you just saw

- **Events are the model.** A cart is four facts (`opened`, `item-added`, `item-removed`, `checked-out`) — you record what happened and fold it on demand, never mutating a "cart object".
- **The projection is a pure fold**, validated against its schema on every build. The creating event (`cart.opened`) seeds the whole shape; every other handler spreads `...current`.
- **The aggregate holds no opinions** — it staged an empty-cart checkout and an over-limit checkout without complaint. Business rules aren't its job.
- **Staged validation is the signature.** Stage → `build` the would-be state → let _your_ code decide. The library computes; your `if` rules. It never learns your limit, and that's the point.

## Where to next

- [Projections](/guide/projections) — the full builder, `from`-seeded resume folds, and the errors `build` can raise.
- [Order fulfillment example](/examples/order-fulfillment) — the same staged-validation move guarding "can't ship unpaid" instead of a checkout.
