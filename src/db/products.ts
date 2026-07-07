import { db } from "./index.js";
import { StoreError } from "../util/errors.js";

/** A product row as stored (money in paise). */
export interface Product {
  sku: string;
  name: string;
  unit: string;
  is_loose: number;
  cost_price: number;
  mrp: number;
  gst_rate: number;
  hsn: string;
  qty: number;
  reorder_level: number;
}

export const ALLOWED_UNITS = ["kg", "g", "litre", "ml", "packet", "dozen", "piece"] as const;
export const ALLOWED_GST = [0, 5, 12, 18, 28] as const;

// ---- Reads -----------------------------------------------------------------

const listStmt = db.prepare("SELECT * FROM products ORDER BY name");
const searchStmt = db.prepare(
  `SELECT * FROM products
   WHERE name LIKE '%' || @q || '%' OR sku LIKE '%' || @q || '%'
   ORDER BY name`,
);
const bySkuStmt = db.prepare("SELECT * FROM products WHERE sku = ?");
const byNameStmt = db.prepare("SELECT * FROM products WHERE lower(name) = lower(?)");
const lowStockStmt = db.prepare(
  "SELECT * FROM products WHERE qty <= reorder_level ORDER BY (qty - reorder_level), name",
);

export function listProducts(): Product[] {
  return listStmt.all() as Product[];
}

/** Fuzzy search by name or sku. Empty/omitted query returns the whole catalogue. */
export function searchProducts(query?: string): Product[] {
  const q = query?.trim();
  if (!q) return listProducts();
  return searchStmt.all({ q }) as Product[];
}

export function getProductBySku(sku: string): Product | undefined {
  return bySkuStmt.get(sku) as Product | undefined;
}

export function listLowStock(): Product[] {
  return lowStockStmt.all() as Product[];
}

/**
 * Resolve a product from a keyword the owner typed. Returns the single match,
 * or throws a StoreError describing the ambiguity / miss so the agent can ask a
 * clarifying question or suggest adding the product.
 */
export function resolveProduct(query: string): Product {
  const q = query.trim();
  const exact = getProductBySku(q) ?? (byNameStmt.get(q) as Product | undefined);
  if (exact) return exact;

  const matches = searchProducts(q);
  if (matches.length === 1) return matches[0]!;
  if (matches.length === 0) {
    throw new StoreError(`No product matches "${query}". Add it first with a new item.`);
  }
  const names = matches.map((p) => `${p.name} [${p.sku}]`).join(", ");
  throw new StoreError(`"${query}" matches ${matches.length} products: ${names}. Which one?`);
}

// ---- Writes ----------------------------------------------------------------

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export interface CreateProductInput {
  sku?: string;
  name: string;
  unit: string;
  is_loose: boolean;
  cost_paise: number; // 0 = unknown
  mrp_paise: number;
  gst_rate: number;
  hsn: string;
  qty: number;
  reorder_level: number;
}

const insertProductStmt = db.prepare(`
  INSERT INTO products
    (sku, name, unit, is_loose, cost_price, mrp, gst_rate, hsn, qty, reorder_level)
  VALUES
    (@sku, @name, @unit, @is_loose, @cost_price, @mrp, @gst_rate, @hsn, @qty, @reorder_level)
`);

/** Create a new SKU. Enforces valid unit/GST, no duplicates, and MRP ≥ cost. */
export const createProduct = db.transaction((input: CreateProductInput): Product => {
  const name = input.name.trim();
  if (!name) throw new StoreError("A product needs a name.");
  if (!ALLOWED_UNITS.includes(input.unit as (typeof ALLOWED_UNITS)[number])) {
    throw new StoreError(`Unit must be one of: ${ALLOWED_UNITS.join(", ")}.`);
  }
  if (!ALLOWED_GST.includes(input.gst_rate as (typeof ALLOWED_GST)[number])) {
    throw new StoreError(`GST rate must be one of: ${ALLOWED_GST.join(", ")}%.`);
  }
  if (input.mrp_paise <= 0) throw new StoreError("MRP must be greater than ₹0.");
  if (input.qty < 0 || input.reorder_level < 0) {
    throw new StoreError("Quantity and reorder level cannot be negative.");
  }
  if (input.cost_paise > 0 && input.mrp_paise < input.cost_paise) {
    throw new StoreError("MRP is below cost — that would sell at a loss. Set MRP at or above cost.");
  }

  const sku = (input.sku?.trim() || slugify(name)) || slugify(name);
  if (!sku) throw new StoreError("Could not derive a product code from that name.");
  if (getProductBySku(sku)) {
    throw new StoreError(`A product with code "${sku}" already exists. Use receive stock to add more.`);
  }
  if (byNameStmt.get(name)) {
    throw new StoreError(`"${name}" already exists in the catalogue. Use receive stock to add more.`);
  }

  insertProductStmt.run({
    sku,
    name,
    unit: input.unit,
    is_loose: input.is_loose ? 1 : 0,
    cost_price: input.cost_paise,
    mrp: input.mrp_paise,
    gst_rate: input.gst_rate,
    hsn: input.hsn.trim(),
    qty: input.qty,
    reorder_level: input.reorder_level,
  });
  return getProductBySku(sku)!;
});

export interface ReceiveStockInput {
  query: string; // name or sku to resolve
  add_qty: number;
  cost_paise?: number; // optional price update
  mrp_paise?: number;
}

export interface ReceiveStockResult {
  product: Product;
  added: number;
  costChanged: boolean;
  mrpChanged: boolean;
}

const updateStockStmt = db.prepare(
  `UPDATE products
   SET qty = qty + @add, cost_price = @cost, mrp = @mrp, updated_at = datetime('now')
   WHERE sku = @sku`,
);

/**
 * Add incoming stock to an existing product (atomic increment), optionally
 * updating cost/MRP. Enforces positive quantity and MRP ≥ cost.
 */
export const receiveStock = db.transaction((input: ReceiveStockInput): ReceiveStockResult => {
  if (input.add_qty <= 0) throw new StoreError("Received quantity must be greater than zero.");

  const product = resolveProduct(input.query); // throws on miss / ambiguity
  const newCost = input.cost_paise ?? product.cost_price;
  const newMrp = input.mrp_paise ?? product.mrp;

  if (newMrp <= 0) throw new StoreError("MRP must be greater than ₹0.");
  if (newCost > 0 && newMrp < newCost) {
    throw new StoreError("MRP is below cost — that would sell at a loss. Adjust the price.");
  }

  updateStockStmt.run({ add: input.add_qty, cost: newCost, mrp: newMrp, sku: product.sku });

  return {
    product: getProductBySku(product.sku)!,
    added: input.add_qty,
    costChanged: newCost !== product.cost_price,
    mrpChanged: newMrp !== product.mrp,
  };
});
