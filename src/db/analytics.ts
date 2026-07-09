import { db } from "./index.js";

/**
 * Read-only sales analytics over finalized bills. Powers both the PPTX analysis
 * deck (Phase 5) and the daily-close summary (Phase 6). All money in paise.
 *
 * bills.finalized_at is stored in UTC (SQLite datetime('now')). We compare it to
 * period bounds formatted the same way, so comparisons are exact absolute
 * instants regardless of the server timezone.
 */

export type PeriodKind = "today" | "week" | "month" | "all";

export interface Period {
  from: string; // 'YYYY-MM-DD HH:MM:SS' UTC
  to: string;
  label: string;
}

/** Format a JS Date as SQLite's UTC datetime string. */
function sqliteUtc(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

export function resolvePeriod(kind: PeriodKind): Period {
  const now = new Date();
  let from: Date;
  let label: string;
  switch (kind) {
    case "today": {
      from = new Date();
      from.setHours(0, 0, 0, 0);
      label = "today";
      break;
    }
    case "week":
      from = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
      label = "last 7 days";
      break;
    case "month":
      from = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
      label = "last 30 days";
      break;
    case "all":
    default:
      from = new Date(0);
      label = "all time";
      break;
  }
  return { from: sqliteUtc(from), to: sqliteUtc(now), label };
}

export interface SalesSummary {
  bills: number;
  sales: number; // total payable across bills
  cgst: number;
  sgst: number;
  gst: number; // cgst + sgst
  cash: number;
  upi: number;
  card: number;
  credit: number; // total put on khata
}

const summaryStmt = db.prepare(`
  SELECT
    COUNT(*) AS bills,
    COALESCE(SUM(total), 0) AS sales,
    COALESCE(SUM(cgst), 0) AS cgst,
    COALESCE(SUM(sgst), 0) AS sgst,
    COALESCE(SUM(cgst + sgst), 0) AS gst,
    COALESCE(SUM(CASE WHEN payment_mode = 'cash' THEN total END), 0) AS cash,
    COALESCE(SUM(CASE WHEN payment_mode = 'upi'  THEN total END), 0) AS upi,
    COALESCE(SUM(CASE WHEN payment_mode = 'card' THEN total END), 0) AS card,
    COALESCE(SUM(CASE WHEN on_credit = 1 THEN total END), 0) AS credit
  FROM bills
  WHERE status = 'final' AND finalized_at >= @from AND finalized_at <= @to
`);

export function salesSummary(period: Period): SalesSummary {
  return summaryStmt.get({ from: period.from, to: period.to }) as SalesSummary;
}

export interface DayTotal {
  day: string; // YYYY-MM-DD (UTC)
  total: number;
}
const byDayStmt = db.prepare(`
  SELECT date(finalized_at) AS day, COALESCE(SUM(total), 0) AS total
  FROM bills
  WHERE status = 'final' AND finalized_at >= @from AND finalized_at <= @to
  GROUP BY day ORDER BY day
`);
export function salesByDay(period: Period): DayTotal[] {
  return byDayStmt.all({ from: period.from, to: period.to }) as DayTotal[];
}

export interface TopItem {
  name: string;
  qty: number;
  revenue: number;
}
const topItemsStmt = db.prepare(`
  SELECT bi.name AS name, SUM(bi.qty) AS qty, SUM(bi.line_total) AS revenue
  FROM bill_items bi JOIN bills b ON b.id = bi.bill_id
  WHERE b.status = 'final' AND b.finalized_at >= @from AND b.finalized_at <= @to
  GROUP BY bi.sku ORDER BY revenue DESC LIMIT @limit
`);
export function topItems(period: Period, limit = 5): TopItem[] {
  return topItemsStmt.all({ from: period.from, to: period.to, limit }) as TopItem[];
}

export interface SlabTotal {
  rate: number;
  taxable: number;
  cgst: number;
  sgst: number;
}
const gstBySlabStmt = db.prepare(`
  SELECT bi.gst_rate AS rate, SUM(bi.line_taxable) AS taxable,
         SUM(bi.line_cgst) AS cgst, SUM(bi.line_sgst) AS sgst
  FROM bill_items bi JOIN bills b ON b.id = bi.bill_id
  WHERE b.status = 'final' AND b.finalized_at >= @from AND b.finalized_at <= @to
  GROUP BY bi.gst_rate ORDER BY bi.gst_rate
`);
export function gstBySlab(period: Period): SlabTotal[] {
  return gstBySlabStmt.all({ from: period.from, to: period.to }) as SlabTotal[];
}

// ---- sales velocity (for reorder suggestions) ------------------------------

export interface VelocityRow {
  sku: string;
  name: string;
  unit: string;
  qty: number;
  reorder_level: number;
  soldInWindow: number;
  windowDays: number;
  dailyVelocity: number;
  daysOfCover: number | null; // null when there were no recent sales
}

const velocityStmt = db.prepare(`
  SELECT p.sku, p.name, p.unit, p.qty, p.reorder_level,
         COALESCE(s.sold, 0) AS soldInWindow
  FROM products p
  LEFT JOIN (
    SELECT bi.sku AS sku, SUM(bi.qty) AS sold
    FROM bill_items bi JOIN bills b ON b.id = bi.bill_id
    WHERE b.status = 'final' AND b.finalized_at >= @from
    GROUP BY bi.sku
  ) s ON s.sku = p.sku
  ORDER BY p.name
`);

/** Per-SKU sales rate over the last `windowDays`, with days-of-cover at that rate. */
export function salesVelocity(windowDays: number): VelocityRow[] {
  const from = sqliteUtc(new Date(Date.now() - windowDays * 24 * 3600 * 1000));
  const rows = velocityStmt.all({ from }) as Array<{
    sku: string;
    name: string;
    unit: string;
    qty: number;
    reorder_level: number;
    soldInWindow: number;
  }>;
  return rows.map((r) => {
    const dailyVelocity = r.soldInWindow / windowDays;
    return {
      ...r,
      windowDays,
      dailyVelocity,
      daysOfCover: dailyVelocity > 0 ? r.qty / dailyVelocity : null,
    };
  });
}
