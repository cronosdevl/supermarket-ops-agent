import { describe, it, expect, beforeEach } from "vitest";
import { receiveStock, resolveProduct, listLowStock, getProductBySku } from "../src/db/products.js";
import { StoreError } from "../src/util/errors.js";
import { resetDb, makeProduct } from "./helpers/db.js";

beforeEach(resetDb);

describe("createProduct — validation guardrails", () => {
  it("creates a product and derives a slug SKU from the name", () => {
    const p = makeProduct({ name: "Aashirvaad Atta 5kg", sku: undefined });
    expect(p.sku).toBe("aashirvaad-atta-5kg");
    expect(p.name).toBe("Aashirvaad Atta 5kg");
  });

  it("rejects an unknown unit", () => {
    expect(() => makeProduct({ unit: "bottle" })).toThrow(StoreError);
  });

  it("rejects a GST rate outside the legal slabs", () => {
    expect(() => makeProduct({ gst_rate: 9 })).toThrow(/GST rate/);
  });

  it("refuses an MRP below cost (would sell at a loss)", () => {
    expect(() => makeProduct({ cost_paise: 5000, mrp_paise: 4000 })).toThrow(/below cost/);
  });

  it("rejects a duplicate name", () => {
    makeProduct({ name: "Maggi", sku: "maggi" });
    expect(() => makeProduct({ name: "Maggi", sku: "maggi-2" })).toThrow(/already exists/);
  });
});

describe("resolveProduct", () => {
  beforeEach(() => {
    makeProduct({ name: "Amul Butter", sku: "amul-butter" });
    makeProduct({ name: "Amul Cheese", sku: "amul-cheese" });
  });

  it("resolves an exact SKU and an exact name", () => {
    expect(resolveProduct("amul-butter").name).toBe("Amul Butter");
    expect(resolveProduct("Amul Cheese").sku).toBe("amul-cheese");
  });

  it("throws on no match", () => {
    expect(() => resolveProduct("Ketchup")).toThrow(/No product matches/);
  });

  it("throws on an ambiguous match, listing the candidates", () => {
    expect(() => resolveProduct("Amul")).toThrow(/matches 2 products/);
  });
});

describe("receiveStock", () => {
  it("atomically increments quantity", () => {
    makeProduct({ name: "Sugar", sku: "sugar", qty: 10 });
    const res = receiveStock({ query: "sugar", add_qty: 25 });
    expect(res.added).toBe(25);
    expect(getProductBySku("sugar")!.qty).toBe(35);
  });

  it("can update cost/MRP on the way in", () => {
    makeProduct({ name: "Salt", sku: "salt", cost_paise: 1000, mrp_paise: 2000 });
    const res = receiveStock({ query: "salt", add_qty: 5, cost_paise: 1200, mrp_paise: 2200 });
    expect(res.costChanged).toBe(true);
    expect(res.mrpChanged).toBe(true);
    expect(getProductBySku("salt")!.mrp).toBe(2200);
  });

  it("rejects a non-positive quantity", () => {
    makeProduct({ name: "Rice", sku: "rice" });
    expect(() => receiveStock({ query: "rice", add_qty: 0 })).toThrow(/greater than zero/);
  });

  it("refuses a price update that puts MRP below cost", () => {
    makeProduct({ name: "Oil", sku: "oil", cost_paise: 10000, mrp_paise: 12000 });
    expect(() => receiveStock({ query: "oil", add_qty: 1, cost_paise: 15000 })).toThrow(/below cost/);
  });
});

describe("listLowStock", () => {
  it("returns only items at or below their reorder level", () => {
    makeProduct({ name: "Low", sku: "low", qty: 2, reorder_level: 5 });
    makeProduct({ name: "AtLevel", sku: "at-level", qty: 5, reorder_level: 5 });
    makeProduct({ name: "Healthy", sku: "healthy", qty: 50, reorder_level: 5 });
    const skus = listLowStock().map((p) => p.sku);
    expect(skus).toContain("low");
    expect(skus).toContain("at-level");
    expect(skus).not.toContain("healthy");
  });
});
