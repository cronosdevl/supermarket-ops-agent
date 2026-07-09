import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { formatINR, rupeesToPaise } from "../db/index.js";
import {
  ALLOWED_GST,
  ALLOWED_UNITS,
  createProduct,
  listLowStock,
  receiveStock,
  searchProducts,
  type Product,
} from "../db/products.js";
import { salesVelocity } from "../db/analytics.js";
import { guard, text } from "./_shared.js";

function describeProduct(p: Product): string {
  const low = p.qty <= p.reorder_level ? "  ⚠️ LOW" : "";
  const per = p.is_loose ? "/kg" : "";
  return (
    `• ${p.name} [${p.sku}] — ${p.qty} ${p.unit} in stock` +
    ` · MRP ${formatINR(p.mrp)}${per} · GST ${p.gst_rate}% · HSN ${p.hsn || "—"}` +
    ` · reorder at ${p.reorder_level}${low}`
  );
}

// ---- get_stock (grounding) -------------------------------------------------

const getStock = tool(
  "get_stock",
  "Look up current stock, price, GST slab and reorder level for products. " +
    "Search by a keyword (e.g. 'sugar', 'atta', 'maggi') or omit the query to " +
    "list the whole catalogue. ALWAYS use this to answer stock/price questions — " +
    "never guess a product, price, or quantity. If a keyword matches more than " +
    "one product, ask the owner which one they mean.",
  {
    query: z
      .string()
      .optional()
      .describe("Product name or keyword to search for. Omit to list everything."),
  },
  async ({ query }) =>
    guard(() => {
      const matches = searchProducts(query);
      if (matches.length === 0) {
        return text(
          query
            ? `No product matches "${query}". It may not be in the catalogue yet.`
            : "The catalogue is empty.",
        );
      }
      const header =
        query && matches.length > 1
          ? `${matches.length} products match "${query}":`
          : query
            ? `Match for "${query}":`
            : `Full catalogue (${matches.length} products):`;
      return text([header, ...matches.map(describeProduct)].join("\n"));
    }),
);

// ---- add_product -----------------------------------------------------------

const addProduct = tool(
  "add_product",
  "Add a brand-new product to the catalogue. Use this for 'new item: ...'. " +
    "Do NOT use this to add stock to an existing product — use receive_stock for that. " +
    `Unit must be one of ${ALLOWED_UNITS.join("/")}; GST must be ${ALLOWED_GST.join("/")}%. ` +
    "Ask the owner for any required detail you don't have (unit, MRP, GST) rather than guessing.",
  {
    name: z.string().describe("Full product name, e.g. 'Amul Butter 100g'"),
    unit: z.enum(ALLOWED_UNITS).describe("Selling unit"),
    mrp: z.number().positive().describe("Sell price per unit in ₹ (MRP)"),
    gst_rate: z
      .number()
      .describe("GST slab as a percent: 0, 5, 12, 18 or 28"),
    cost_price: z.number().optional().describe("Purchase cost per unit in ₹, if known"),
    hsn: z.string().optional().describe("HSN tax code, if known"),
    is_loose: z.boolean().optional().describe("True if sold loose by weight/volume"),
    reorder_level: z.number().optional().describe("Low-stock alert threshold; default 0"),
    opening_qty: z.number().optional().describe("Opening stock on hand; default 0"),
    sku: z.string().optional().describe("Short code; auto-generated from the name if omitted"),
  },
  async (a) =>
    guard(() => {
      const p = createProduct({
        sku: a.sku,
        name: a.name,
        unit: a.unit,
        is_loose: a.is_loose ?? false,
        cost_paise: a.cost_price != null ? rupeesToPaise(a.cost_price) : 0,
        mrp_paise: rupeesToPaise(a.mrp),
        gst_rate: a.gst_rate,
        hsn: a.hsn ?? "",
        qty: a.opening_qty ?? 0,
        reorder_level: a.reorder_level ?? 0,
      });
      const cost = p.cost_price > 0 ? `, cost ${formatINR(p.cost_price)}` : "";
      return text(
        `✓ Added ${p.name} [${p.sku}] — MRP ${formatINR(p.mrp)}${cost}, GST ${p.gst_rate}%, ` +
          `HSN ${p.hsn || "—"}, opening stock ${p.qty} ${p.unit}.`,
      );
    }),
);

// ---- receive_stock ---------------------------------------------------------

const receiveStockTool = tool(
  "receive_stock",
  "Record stock arriving for an EXISTING product (e.g. '50 packets of Maggi came in, " +
    "cost ₹12, MRP ₹14'). Increments quantity and optionally updates cost/MRP. If the " +
    "product doesn't exist yet, use add_product instead. If the name is ambiguous, the " +
    "tool will report the matches so you can ask which one.",
  {
    product: z.string().describe("Which product received stock — name or code, e.g. 'Maggi'"),
    qty: z.number().positive().describe("Quantity received, in the product's own unit"),
    cost_price: z.number().optional().describe("New purchase cost per unit in ₹, if it changed"),
    mrp: z.number().optional().describe("New sell price per unit in ₹, if it changed"),
  },
  async (a) =>
    guard(() => {
      const r = receiveStock({
        query: a.product,
        add_qty: a.qty,
        cost_paise: a.cost_price != null ? rupeesToPaise(a.cost_price) : undefined,
        mrp_paise: a.mrp != null ? rupeesToPaise(a.mrp) : undefined,
      });
      const changes: string[] = [];
      if (r.costChanged) changes.push(`cost now ${formatINR(r.product.cost_price)}`);
      if (r.mrpChanged) changes.push(`MRP now ${formatINR(r.product.mrp)}`);
      const extra = changes.length ? ` (${changes.join(", ")})` : "";
      return text(
        `✓ Received ${r.added} ${r.product.unit} of ${r.product.name}. ` +
          `Stock now ${r.product.qty} ${r.product.unit}${extra}.`,
      );
    }),
);

// ---- list_low_stock --------------------------------------------------------

const listLowStockTool = tool(
  "list_low_stock",
  "Report products that need attention — answers 'what's running out?' / " +
    "'what should I reorder?'. Splits results into OUT OF STOCK (zero on hand) and " +
    "RUNNING LOW (still some stock, but at or below the reorder level). Takes no input.",
  {},
  async () =>
    guard(() => {
      const flagged = listLowStock(); // qty <= reorder_level
      const out = flagged.filter((p) => p.qty <= 0);
      const low = flagged.filter((p) => p.qty > 0);

      if (out.length === 0 && low.length === 0) {
        return text("All good — nothing out of stock or below its reorder level.");
      }

      const parts: string[] = [];
      if (out.length > 0) {
        parts.push(`❌ Out of stock (${out.length}):`);
        for (const p of out) parts.push(`• ${p.name} — 0 ${p.unit}`);
      }
      if (low.length > 0) {
        if (parts.length) parts.push("");
        parts.push(`⚠️ Running low (${low.length}):`);
        for (const p of low) {
          parts.push(`• ${p.name} — ${p.qty} ${p.unit} left (reorder at ${p.reorder_level})`);
        }
      }
      return text(parts.join("\n"));
    }),
);

// ---- reorder_suggestions (sales-velocity based) ----------------------------

const reorderSuggestions = tool(
  "reorder_suggestions",
  "Suggest what to reorder based on how fast items are actually selling (sales " +
    "velocity), not just the fixed reorder level — 'what should I restock?'. For each " +
    "at-risk item it estimates the daily sales rate, how many days of stock are left, " +
    "and a suggested order quantity. Prefer this over list_low_stock when the owner " +
    "asks what/how much to reorder.",
  {
    window_days: z
      .number()
      .optional()
      .describe("Days of sales history to measure velocity over (default 14)"),
    cover_days: z
      .number()
      .optional()
      .describe("How many days of stock a restock should cover (default 14)"),
  },
  async (a) =>
    guard(() => {
      const windowDays = a.window_days && a.window_days > 0 ? a.window_days : 14;
      const coverDays = a.cover_days && a.cover_days > 0 ? a.cover_days : 14;
      const rows = salesVelocity(windowDays);

      const flagged = rows
        .map((r) => {
          const belowReorder = r.qty <= r.reorder_level;
          const runningOut = r.daysOfCover !== null && r.daysOfCover <= coverDays;
          if (!belowReorder && !runningOut) return null;
          const suggested =
            r.dailyVelocity > 0
              ? Math.max(Math.ceil(r.dailyVelocity * coverDays) - r.qty, 0)
              : Math.max(Math.ceil(r.reorder_level - r.qty), 0);
          return { ...r, suggested, sortKey: r.daysOfCover ?? Number.POSITIVE_INFINITY };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null)
        .sort((x, y) => x.sortKey - y.sortKey);

      if (flagged.length === 0) {
        return text(`Nothing needs reordering — stock is healthy at current sales rates (last ${windowDays} days).`);
      }

      const lines = [`Reorder suggestions (sales velocity over last ${windowDays} days):`];
      for (const r of flagged) {
        if (r.dailyVelocity > 0) {
          const cover = r.daysOfCover === null ? "" : `~${r.daysOfCover.toFixed(1)} days left`;
          lines.push(
            `• ${r.name} — ${r.qty} ${r.unit} left, selling ~${r.dailyVelocity.toFixed(1)}/day (${cover}).` +
              (r.suggested > 0 ? ` Suggest ordering ~${r.suggested} ${r.unit} (${coverDays}-day cover).` : ""),
          );
        } else {
          lines.push(
            `• ${r.name} — ${r.qty} ${r.unit} left (at/below reorder ${r.reorder_level}), no recent sales.` +
              (r.suggested > 0 ? ` Suggest ~${r.suggested} ${r.unit} to restock.` : ""),
          );
        }
      }
      return text(lines.join("\n"));
    }),
);

/** Inventory tools are store-global (no per-chat context needed). */
export function inventoryTools() {
  return [getStock, addProduct, receiveStockTool, listLowStockTool, reorderSuggestions];
}
