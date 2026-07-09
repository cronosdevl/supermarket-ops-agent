import { describe, it, expect } from "vitest";
import { computeLineGst, computeBill, roundToRupee } from "../src/domain/gst.js";

describe("computeLineGst — GST-inclusive back-out", () => {
  it("splits a ₹100 line at 18% into an exact taxable + CGST + SGST breakup", () => {
    // ₹100 = 10000 paise, GST-inclusive. taxable = round(10000 * 100 / 118).
    const g = computeLineGst(10000, 1, 18);
    expect(g.gross).toBe(10000);
    expect(g.taxable).toBe(8475); // 10000 * 100 / 118 = 8474.58 → 8475
    expect(g.tax).toBe(1525);
    expect(g.cgst).toBe(762); // floor(1525 / 2)
    expect(g.sgst).toBe(763); // remainder keeps the sum exact
  });

  it("never loses a paisa: taxable + cgst + sgst === gross for any inputs", () => {
    const cases: Array<[number, number, number]> = [
      [10000, 1, 18],
      [4999, 3, 12],
      [12345, 2.5, 5],
      [99999, 7, 28],
      [1, 1, 18],
    ];
    for (const [price, qty, rate] of cases) {
      const g = computeLineGst(price, qty, rate);
      expect(g.taxable + g.cgst + g.sgst).toBe(g.gross);
      expect(g.cgst + g.sgst).toBe(g.tax);
    }
  });

  it("treats a 0% slab as fully taxable with no tax", () => {
    const g = computeLineGst(5000, 2, 0);
    expect(g.gross).toBe(10000);
    expect(g.taxable).toBe(10000);
    expect(g.tax).toBe(0);
    expect(g.cgst).toBe(0);
    expect(g.sgst).toBe(0);
  });

  it("handles fractional (loose) quantities", () => {
    const g = computeLineGst(6000, 1.5, 5); // 1.5 kg atta @ ₹60/kg
    expect(g.gross).toBe(9000);
    expect(g.taxable + g.cgst + g.sgst).toBe(9000);
  });
});

describe("computeBill — aggregation and per-slab breakup", () => {
  it("aggregates totals and returns one sorted row per GST slab present", () => {
    const totals = computeBill([
      { unit_price: 10000, qty: 1, gst_rate: 18 },
      { unit_price: 5000, qty: 2, gst_rate: 5 },
      { unit_price: 2000, qty: 1, gst_rate: 18 },
    ]);

    // Two distinct slabs, ascending.
    expect(totals.byRate.map((r) => r.rate)).toEqual([5, 18]);
    // Grand total is the sum of every gross.
    expect(totals.total).toBe(10000 + 10000 + 2000);
    // Bill-level invariant: subtotal + cgst + sgst === total.
    expect(totals.subtotal + totals.cgst + totals.sgst).toBe(totals.total);
  });

  it("returns zeroed totals and no slabs for an empty bill", () => {
    const totals = computeBill([]);
    expect(totals).toMatchObject({ subtotal: 0, cgst: 0, sgst: 0, total: 0 });
    expect(totals.byRate).toEqual([]);
  });
});

describe("roundToRupee", () => {
  it("rounds down and reports a negative round-off", () => {
    expect(roundToRupee(10049)).toEqual({ payable: 10000, roundOff: -49 });
  });
  it("rounds up and reports a positive round-off", () => {
    expect(roundToRupee(10050)).toEqual({ payable: 10100, roundOff: 50 });
  });
  it("is a no-op on an exact rupee amount", () => {
    expect(roundToRupee(10000)).toEqual({ payable: 10000, roundOff: 0 });
  });
});
