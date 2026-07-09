import { pathToFileURL } from "node:url";
import { db, initDb, rupeesToPaise } from "./index.js";

/**
 * Seed a realistic Indian kirana catalogue with correct HSN codes and GST slabs.
 *
 *   npm run seed            -> insert missing SKUs (keeps existing stock)
 *   npm run seed -- --reset -> wipe products first, then reseed
 *
 * GST slabs used (intra-state, so each splits into CGST + SGST at half the rate):
 *   0%  loose/unbranded staples (atta, rice, dal), salt, fresh milk
 *   5%  branded packaged staples (packaged atta, edible oil), sugar
 *   12% butter
 *   18% instant noodles, biscuits, detergent
 */

type Seed = {
  sku: string;
  name: string;
  unit: string;
  is_loose: 0 | 1;
  cost: number; // rupees per unit
  mrp: number; // rupees per unit
  gst: number; // percent
  hsn: string;
  qty: number;
  reorder: number;
};

const CATALOGUE: Seed[] = [
  // Packaged staples
  { sku: "aashirvaad-atta-5kg", name: "Aashirvaad Atta 5kg", unit: "packet", is_loose: 0, cost: 250, mrp: 280, gst: 5, hsn: "1101", qty: 20, reorder: 5 },
  { sku: "tata-salt-1kg", name: "Tata Salt 1kg", unit: "packet", is_loose: 0, cost: 22, mrp: 28, gst: 0, hsn: "2501", qty: 40, reorder: 10 },
  { sku: "fortune-oil-1l", name: "Fortune Sunflower Oil 1L", unit: "packet", is_loose: 0, cost: 135, mrp: 155, gst: 5, hsn: "1512", qty: 25, reorder: 6 },
  { sku: "amul-butter-100g", name: "Amul Butter 100g", unit: "packet", is_loose: 0, cost: 52, mrp: 62, gst: 12, hsn: "0405", qty: 30, reorder: 8 },
  { sku: "amul-taaza-500ml", name: "Amul Taaza Milk 500ml", unit: "packet", is_loose: 0, cost: 26, mrp: 30, gst: 0, hsn: "0401", qty: 36, reorder: 12 },

  // FMCG (higher slabs)
  { sku: "maggi-70g", name: "Maggi 70g", unit: "packet", is_loose: 0, cost: 12, mrp: 14, gst: 18, hsn: "1902", qty: 60, reorder: 15 },
  { sku: "parle-g", name: "Parle-G Biscuits", unit: "packet", is_loose: 0, cost: 8, mrp: 10, gst: 18, hsn: "1905", qty: 100, reorder: 20 },
  { sku: "surf-excel-1kg", name: "Surf Excel 1kg", unit: "packet", is_loose: 0, cost: 95, mrp: 110, gst: 18, hsn: "3402", qty: 18, reorder: 5 },

  // Loose items (sold by the kg) — unbranded staples are 0%, sugar is 5%
  { sku: "loose-atta", name: "Loose Atta (per kg)", unit: "kg", is_loose: 1, cost: 32, mrp: 38, gst: 0, hsn: "1101", qty: 60, reorder: 15 },
  { sku: "loose-rice", name: "Loose Rice (per kg)", unit: "kg", is_loose: 1, cost: 48, mrp: 55, gst: 0, hsn: "1006", qty: 80, reorder: 20 },
  { sku: "loose-toor-dal", name: "Loose Toor Dal (per kg)", unit: "kg", is_loose: 1, cost: 110, mrp: 130, gst: 0, hsn: "0713", qty: 40, reorder: 10 },
  { sku: "loose-sugar", name: "Loose Sugar (per kg)", unit: "kg", is_loose: 1, cost: 40, mrp: 45, gst: 5, hsn: "1701", qty: 50, reorder: 10 },
];

/** Seed the catalogue. `reset` wipes products first; otherwise missing SKUs are
 *  inserted and existing stock is left untouched. Returns the number inserted. */
export function seedCatalogue(reset = false): number {
  initDb();

  if (reset) {
    db.prepare("DELETE FROM products").run();
  }

  const insert = db.prepare(`
    INSERT OR IGNORE INTO products
      (sku, name, unit, is_loose, cost_price, mrp, gst_rate, hsn, qty, reorder_level)
    VALUES
      (@sku, @name, @unit, @is_loose, @cost_price, @mrp, @gst_rate, @hsn, @qty, @reorder_level)
  `);

  const run = db.transaction((rows: Seed[]) => {
    let added = 0;
    for (const r of rows) {
      const res = insert.run({
        sku: r.sku,
        name: r.name,
        unit: r.unit,
        is_loose: r.is_loose,
        cost_price: rupeesToPaise(r.cost),
        mrp: rupeesToPaise(r.mrp),
        gst_rate: r.gst,
        hsn: r.hsn,
        qty: r.qty,
        reorder_level: r.reorder,
      });
      added += res.changes;
    }
    return added;
  });

  return run(CATALOGUE);
}

/** Seed the catalogue only if it's empty — used on boot so a fresh deploy comes
 *  up with a stocked store. Returns true if seeding happened. */
export function seedIfEmpty(): boolean {
  initDb();
  const { c } = db.prepare("SELECT COUNT(*) c FROM products").get() as { c: number };
  if (c > 0) return false;
  seedCatalogue(false);
  return true;
}

// CLI entry: `npm run seed` / `npm run seed -- --reset`
const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
if (isMain) {
  const reset = process.argv.includes("--reset");
  if (reset) console.log("↺ products table cleared");
  const added = seedCatalogue(reset);
  const total = db.prepare("SELECT COUNT(*) c FROM products").get() as { c: number };
  console.log(`✓ seed complete: ${added} new SKU(s) inserted, ${total.c} total in catalogue`);
}
