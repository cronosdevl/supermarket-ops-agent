# Testing Guide — Supermarket Ops Agent

Manual end-to-end test script for the Telegram bot. Covers everything built so
far (Phases 0–5). Send each prompt as a separate message to the bot; **→** marks
the expected result.

---

## Setup (clean slate for predictable numbers)

Stop the bot if running, wipe the DB, reseed the 12 known SKUs, and start:

```bash
# from the project root
rm -f data/store.db data/store.db-wal data/store.db-shm
npm run seed        # 12 clean SKUs with real HSN + GST slabs
npm run dev         # starts the bot (auto-reloads on edits)
```

Then in Telegram open **@SupermarketOpsAgentBot** and send `/start`.

> Tip: a fully clean DB also resets khata customers, bills, and shop details.
> To keep products but reset just the catalogue quantities, use `npm run seed -- --reset`.

---

## A · Grounding & stock queries (Phase 1)

- [ ] `how much sugar is left?` → **50 kg**, ₹45/kg, GST 5%
- [ ] `what's the price of Amul butter?` → **₹62**, GST 12%
- [ ] `show me the full catalogue` → all 12 products with stock / price / GST

## B · Ambiguity → the model asks (not a hardcoded branch)

- [ ] `how much atta do I have?` → lists **both** Aashirvaad 5kg *and* Loose Atta and asks which one

## C · Inventory (Phase 2)

- [ ] `50 packets of Maggi came in, cost ₹12, MRP ₹14` → Maggi **60 → 110**
- [ ] `new item: Colgate 100g, GST 18%, MRP ₹55` → added (per piece)
- [ ] `30 Colgate came in` → Colgate stock **0 → 30**
- [ ] `what's running out?` → OUT OF STOCK / RUNNING LOW list

## D · Inventory guardrails (should be refused)

- [ ] `new item: Loss Leader, unit piece, cost ₹20, MRP ₹10, GST 18%` → **refused** (MRP below cost)
- [ ] `new item: Weird Item, unit piece, MRP ₹30, GST 7%` → **refused** (7% not a valid GST slab)
- [ ] `add 5 Maggi Deluxe to stock` → **refused / asks to add the product first** (doesn't exist)

## E · Billing + multi-turn edits + GST (Phase 3)

- [ ] `make a bill: 2kg sugar, 1 Aashirvaad atta 5kg, 4 Maggi, 1 Amul butter` → draft, **₹488.00**
- [ ] `drop the butter, make it 6 Maggi` → edited
- [ ] `show me the bill with GST breakup` → per-slab CGST/SGST, **₹454.00**
- [ ] `customer paid by UPI, ref UPI789 — finalize it` → finalized; stock decremented **once**

## F · Oversell guard (hard-part #2)

- [ ] `make a bill: 1000 Maggi, cash` → **refused / warned** (not enough stock); stock unchanged
- [ ] `cancel that bill` → draft discarded

## G · Khata / credit ledger (Phase 4)

- [ ] `put ₹500 on Ramesh's credit` → Ramesh owes **₹500**
- [ ] `what's Ramesh's balance?` → **₹500**
- [ ] `Ramesh paid ₹300` → owes **₹200**
- [ ] `make a bill: 2 Maggi, put it on Suresh's khata` → credit sale; Suresh owes the bill total
- [ ] `Suresh's balance?` → shows what he owes
- [ ] `who owes me money?` → outstanding list with total
- [ ] `Mahesh paid ₹100` → **refused** (no khata account) — guardrail #7

## H · Documents — real artifacts (Phase 5)

- [ ] `set my shop to Sharma Kirana Store, GSTIN 27ABCDE1234F1Z5, address 12 MG Road Pune, state Maharashtra, phone 9876543210` → saved
- [ ] `send me that bill as a PDF` → **PDF invoice** as a document (GST-correct, ₹ symbol, HSN, CGST/SGST, amount in words)
- [ ] `send bill #1 as a PDF` → invoice for that specific bill
- [ ] `make this week's sales analysis deck` → **PPTX** with real charts (sales, top items, GST, payment mix, stock/credit health)

## I · Daily close (Phase 6)

- [ ] `today's sales?` → total, tax collected (CGST/SGST), cash vs UPI vs card vs credit, top items
- [ ] `close the day` → same summary
- [ ] `this week's numbers` → summary for the last 7 days

## J · Memory across sessions (Phase 6, hard-part #9)

- [ ] `always assume UPI unless I say cash` → remembered
- [ ] `when I say atta, I mean Aashirvaad Atta 5kg` → remembered
- [ ] `what do you remember about my preferences?` → lists both
- [ ] `/new` → fresh chat (conversation cleared; preferences live in the DB)
- [ ] `make a bill for 4 Maggi and 1 atta, then finalize it` → **applies both prefs**: picks Aashirvaad for "atta" without asking, and finalizes as **UPI** without asking the payment mode
- [ ] `stop assuming UPI` → forgets that preference

## K · Session behaviour

- [ ] `/new` → "fresh chat" (clears conversation; stock / khata / shop / preferences data stays)
- [ ] `how much sugar is left?` → still grounded after `/new`

---

## Automated checks (developer)

The domain/repo logic is covered by throwaway test scripts during development;
the always-on check is the type checker:

```bash
npm run typecheck   # must be clean
```

Hard-parts verified during the build (each with a temp-DB test + a live agent run):
grounding, ambiguity clarification, oversell guard + rollback, decrement-only-on-finalize,
idempotent finalize, concurrency (two bills can't oversell), GST correctness (inclusive
MRP → CGST/SGST split, exact paise), khata guardrails, and real PDF/PPTX artifacts.
