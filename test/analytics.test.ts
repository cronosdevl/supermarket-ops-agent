import { describe, it, expect, beforeEach } from "vitest";
import { addLine, finalizeDraft } from "../src/db/bills.js";
import { resolvePeriod, salesSummary, topItems, salesVelocity } from "../src/db/analytics.js";
import { resetDb, makeProduct } from "./helpers/db.js";

beforeEach(resetDb);

/** Sell `qty` of a product on a fresh single-line bill and finalize it. */
function sell(
  chat: number,
  sku: string,
  qty: number,
  settlement: Parameters<typeof finalizeDraft>[0]["settlement"],
) {
  addLine(chat, sku, qty);
  return finalizeDraft({ chatId: chat, settlement });
}

describe("salesSummary", () => {
  it("aggregates finalized bills by payment mode and tax", () => {
    makeProduct({ name: "Maggi", sku: "maggi", qty: 100, mrp_paise: 1200, gst_rate: 18 });
    makeProduct({ name: "Rice", sku: "rice", qty: 100, mrp_paise: 5000, gst_rate: 5 });

    const cashBill = sell(1, "maggi", 2, { type: "paid", mode: "cash" });
    const creditBill = sell(2, "rice", 1, { type: "credit", customer: "Ramesh" });

    const summary = salesSummary(resolvePeriod("all"));
    expect(summary.bills).toBe(2);
    expect(summary.sales).toBe(cashBill.bill.total + creditBill.bill.total);
    expect(summary.cash).toBe(cashBill.bill.total);
    expect(summary.credit).toBe(creditBill.bill.total);
    expect(summary.gst).toBe(summary.cgst + summary.sgst);
  });

  it("reports an empty period as all-zero without throwing", () => {
    const summary = salesSummary(resolvePeriod("today"));
    expect(summary.bills).toBe(0);
    expect(summary.sales).toBe(0);
  });
});

describe("topItems", () => {
  it("ranks items by revenue", () => {
    makeProduct({ name: "Maggi", sku: "maggi", qty: 100, mrp_paise: 1200, gst_rate: 18 });
    makeProduct({ name: "Rice", sku: "rice", qty: 100, mrp_paise: 5000, gst_rate: 5 });
    sell(1, "rice", 3, { type: "paid", mode: "cash" }); // ₹150
    sell(1, "maggi", 2, { type: "paid", mode: "cash" }); // ₹24

    const top = topItems(resolvePeriod("all"));
    expect(top[0]!.name).toBe("Rice");
    expect(top[0]!.revenue).toBeGreaterThan(top[1]!.revenue);
  });
});

describe("salesVelocity", () => {
  it("computes a daily rate and days-of-cover from recent sales", () => {
    makeProduct({ name: "Maggi", sku: "maggi", qty: 70, mrp_paise: 1200, gst_rate: 18 });
    sell(1, "maggi", 7, { type: "paid", mode: "cash" });

    const row = salesVelocity(7).find((r) => r.sku === "maggi")!;
    expect(row.soldInWindow).toBe(7);
    expect(row.dailyVelocity).toBeCloseTo(1, 5); // 7 sold / 7 days
    expect(row.daysOfCover).toBeCloseTo(63, 5); // 63 left / 1 per day
  });

  it("leaves days-of-cover null for a product with no recent sales", () => {
    makeProduct({ name: "Slow", sku: "slow", qty: 10 });
    const row = salesVelocity(7).find((r) => r.sku === "slow")!;
    expect(row.soldInWindow).toBe(0);
    expect(row.daysOfCover).toBeNull();
  });
});
