import { db } from "../../src/db/index.js";
import { createProduct, type CreateProductInput, type Product } from "../../src/db/products.js";

// Data tables in dependency order (children first) so DELETEs don't trip foreign
// keys. shop_config is a fixed single row we re-seed rather than leave empty.
const DATA_TABLES = [
  "bill_items",
  "bills",
  "khata_ledger",
  "khata_customers",
  "products",
  "preferences",
  "processed_updates",
];

/** Wipe every table so each test starts from a known-empty store. */
export function resetDb(): void {
  db.pragma("foreign_keys = OFF");
  for (const table of DATA_TABLES) db.exec(`DELETE FROM ${table}`);
  // Reset AUTOINCREMENT counters so bill ids are stable across tests.
  try {
    db.exec("DELETE FROM sqlite_sequence");
  } catch {
    // sqlite_sequence only exists once an AUTOINCREMENT table has been created;
    // safe to ignore if it isn't there yet.
  }
  db.exec("DELETE FROM shop_config");
  db.prepare("INSERT OR IGNORE INTO shop_config (id) VALUES (1)").run();
  db.pragma("foreign_keys = ON");
}

/** Create a product with sensible defaults; override any field per test. */
export function makeProduct(overrides: Partial<CreateProductInput> = {}): Product {
  return createProduct({
    name: "Test Item",
    unit: "piece",
    is_loose: false,
    cost_paise: 1000,
    mrp_paise: 2000,
    gst_rate: 5,
    hsn: "",
    qty: 100,
    reorder_level: 10,
    ...overrides,
  });
}
