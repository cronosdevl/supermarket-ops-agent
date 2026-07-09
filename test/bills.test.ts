import { describe, it, expect, beforeEach } from "vitest";
import {
  addLine,
  setLineQty,
  removeLine,
  cancelDraft,
  finalizeDraft,
  getOpenDraft,
  getOpenDraftWithItems,
} from "../src/db/bills.js";
import { getProductBySku } from "../src/db/products.js";
import { balanceOf } from "../src/db/khata.js";
import { computeBill } from "../src/domain/gst.js";
import { StoreError } from "../src/util/errors.js";
import { resetDb, makeProduct } from "./helpers/db.js";

const CHAT = 555;

beforeEach(resetDb);

describe("draft building", () => {
  it("opens a draft on first add and merges quantity on repeat", () => {
    makeProduct({ name: "Maggi", sku: "maggi", qty: 100 });
    addLine(CHAT, "maggi", 2);
    const after = addLine(CHAT, "maggi", 3);
    expect(after.qty).toBe(5); // merged, not a second line
    const draft = getOpenDraftWithItems(CHAT)!;
    expect(draft.items).toHaveLength(1);
    expect(draft.items[0]!.qty).toBe(5);
  });

  it("sets an absolute quantity and removes a line", () => {
    makeProduct({ name: "Maggi", sku: "maggi", qty: 100 });
    addLine(CHAT, "maggi", 2);
    setLineQty(CHAT, "maggi", 6);
    expect(getOpenDraftWithItems(CHAT)!.items[0]!.qty).toBe(6);
    removeLine(CHAT, "maggi");
    expect(getOpenDraftWithItems(CHAT)!.items).toHaveLength(0);
  });

  it("does NOT reserve stock while building the draft", () => {
    makeProduct({ name: "Maggi", sku: "maggi", qty: 100 });
    addLine(CHAT, "maggi", 10);
    expect(getProductBySku("maggi")!.qty).toBe(100); // untouched until finalize
  });

  it("cancelling a draft voids it and leaves stock untouched", () => {
    makeProduct({ name: "Maggi", sku: "maggi", qty: 100 });
    addLine(CHAT, "maggi", 10);
    cancelDraft(CHAT);
    expect(getOpenDraft(CHAT)).toBeUndefined();
    expect(getProductBySku("maggi")!.qty).toBe(100);
  });
});

describe("finalizeDraft — the money path", () => {
  it("decrements stock, computes GST, and marks the bill final (paid)", () => {
    makeProduct({ name: "Maggi", sku: "maggi", qty: 100, mrp_paise: 1200, gst_rate: 18 });
    makeProduct({ name: "Salt", sku: "salt", qty: 50, mrp_paise: 2000, gst_rate: 5 });
    addLine(CHAT, "maggi", 2);
    addLine(CHAT, "salt", 1);

    const { bill, items } = finalizeDraft({
      chatId: CHAT,
      settlement: { type: "paid", mode: "cash" },
    });

    expect(bill.status).toBe("final");
    expect(bill.payment_mode).toBe("cash");
    expect(getProductBySku("maggi")!.qty).toBe(98);
    expect(getProductBySku("salt")!.qty).toBe(49);

    // Persisted totals match the domain calculation exactly.
    const expected = computeBill([
      { unit_price: 1200, qty: 2, gst_rate: 18 },
      { unit_price: 2000, qty: 1, gst_rate: 5 },
    ]);
    expect(bill.total).toBe(expected.total);
    expect(bill.subtotal).toBe(expected.subtotal);
    expect(bill.cgst + bill.sgst).toBe(expected.cgst + expected.sgst);
    // Per-line breakup was filled in on finalize.
    expect(items.every((i) => i.line_total > 0)).toBe(true);
  });

  it("puts a credit sale on the customer's khata for the exact bill total", () => {
    makeProduct({ name: "Rice", sku: "rice", qty: 100, mrp_paise: 5000, gst_rate: 5 });
    addLine(CHAT, "rice", 3);
    const { bill } = finalizeDraft({
      chatId: CHAT,
      settlement: { type: "credit", customer: "Ramesh" },
    });
    expect(bill.on_credit).toBe(1);
    expect(balanceOf("Ramesh").balance).toBe(bill.total);
  });

  it("refuses to finalize an empty bill", () => {
    makeProduct({ name: "Rice", sku: "rice", qty: 10 });
    addLine(CHAT, "rice", 1);
    removeLine(CHAT, "rice");
    expect(() => finalizeDraft({ chatId: CHAT, settlement: { type: "paid", mode: "cash" } })).toThrow(
      /empty/,
    );
  });
});

describe("hard part §4 — oversell guard rolls the WHOLE bill back", () => {
  it("throws and leaves every stock level and the draft untouched", () => {
    makeProduct({ name: "Maggi", sku: "maggi", qty: 5, mrp_paise: 1200, gst_rate: 18 });
    makeProduct({ name: "Salt", sku: "salt", qty: 50, mrp_paise: 2000, gst_rate: 5 });
    addLine(CHAT, "salt", 1); // this line is fine...
    addLine(CHAT, "maggi", 10); // ...but this one oversells

    expect(() => finalizeDraft({ chatId: CHAT, settlement: { type: "paid", mode: "cash" } })).toThrow(
      StoreError,
    );

    // Atomic rollback: neither line was decremented, and the draft is still open.
    expect(getProductBySku("maggi")!.qty).toBe(5);
    expect(getProductBySku("salt")!.qty).toBe(50);
    expect(getOpenDraft(CHAT)).toBeDefined();
  });
});

describe("hard part §5 — finalize is idempotent (draft is consumed)", () => {
  it("a retried finalize finds no draft, so stock is decremented exactly once", () => {
    makeProduct({ name: "Maggi", sku: "maggi", qty: 100 });
    addLine(CHAT, "maggi", 4);

    finalizeDraft({ chatId: CHAT, settlement: { type: "paid", mode: "cash" } });
    expect(getProductBySku("maggi")!.qty).toBe(96);

    // No open draft remains; a second finalize is a no-op that refuses.
    expect(getOpenDraft(CHAT)).toBeUndefined();
    expect(() => finalizeDraft({ chatId: CHAT, settlement: { type: "paid", mode: "cash" } })).toThrow(
      /no open bill/i,
    );
    expect(getProductBySku("maggi")!.qty).toBe(96); // still once
  });
});

describe("per-chat isolation", () => {
  it("keeps two chats' drafts independent", () => {
    makeProduct({ name: "Maggi", sku: "maggi", qty: 100 });
    addLine(111, "maggi", 2);
    addLine(222, "maggi", 5);
    expect(getOpenDraftWithItems(111)!.items[0]!.qty).toBe(2);
    expect(getOpenDraftWithItems(222)!.items[0]!.qty).toBe(5);
  });
});
