import { getShopConfig } from "../db/shop.js";
import { listLowStock } from "../db/products.js";
import { listOutstanding } from "../db/khata.js";
import {
  gstBySlab,
  resolvePeriod,
  salesByDay,
  salesSummary,
  topItems,
  type PeriodKind,
} from "../db/analytics.js";
import type { DeckData } from "./analysis-deck.js";

/**
 * Assemble everything the analysis deck needs for a period. Shared by the
 * on-demand `generate_analysis_deck` tool and the scheduled weekly auto-send.
 */
export function buildDeckData(kind: PeriodKind): DeckData {
  const period = resolvePeriod(kind);
  const shop = getShopConfig();

  const lowStock = listLowStock().map((p) => ({
    name: p.name,
    qty: p.qty,
    unit: p.unit,
    reorder: p.reorder_level,
    out: p.qty <= 0,
  }));
  const outstanding = listOutstanding()
    .filter((o) => o.balance > 0)
    .map((o) => ({ name: o.customer.name, balance: o.balance }));

  return {
    shopName: shop.name || "My Kirana Store",
    generatedAt: new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC",
    period,
    summary: salesSummary(period),
    byDay: salesByDay(period),
    top: topItems(period, 6),
    slabs: gstBySlab(period),
    lowStock,
    outstanding,
  };
}
