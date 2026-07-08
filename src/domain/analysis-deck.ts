import PptxDefault from "pptxgenjs";
import { formatINR } from "../db/index.js";
import type { DayTotal, Period, SalesSummary, SlabTotal, TopItem } from "../db/analytics.js";

// pptxgenjs's default export resolves differently across runtimes (esbuild/tsx
// wraps it as { default: ctor }, plain Node ESM gives the ctor directly). Pick
// whichever candidate is actually constructable. Slide API is typed loosely —
// the generated .pptx is verified at runtime.
const Pptx = (typeof PptxDefault === "function"
  ? PptxDefault
  : (PptxDefault as unknown as { default: unknown }).default) as { new (): any };

export interface DeckData {
  shopName: string;
  generatedAt: string;
  period: Period;
  summary: SalesSummary;
  byDay: DayTotal[];
  top: TopItem[];
  slabs: SlabTotal[];
  lowStock: { name: string; qty: number; unit: string; reorder: number; out: boolean }[];
  outstanding: { name: string; balance: number }[];
}

const rupees = (paise: number) => paise / 100;
const ACCENT = "1F6F4A";
const INK = "222222";
const MUTED = "666666";
const PALETTE = ["1F6F4A", "C77D2E", "3B6EA5", "9A4C95", "B0413E", "7A7A7A"];

/** Build a business-analysis deck (.pptx) with real charts and write it to outPath. */
export async function renderAnalysisDeck(data: DeckData, outPath: string): Promise<void> {
  const pptx = new Pptx();
  pptx.layout = "LAYOUT_WIDE"; // 13.33 x 7.5 in
  pptx.author = data.shopName;
  pptx.title = `Sales Analysis — ${data.period.label}`;

  titleSlide(pptx, data);
  kpiSlide(pptx, data);
  salesTrendSlide(pptx, data);
  topItemsSlide(pptx, data);
  gstAndPaymentSlide(pptx, data);
  healthSlide(pptx, data);

  await pptx.writeFile({ fileName: outPath });
}

function heading(slide: any, title: string): void {
  slide.addText(title, { x: 0.5, y: 0.3, w: 12.3, h: 0.6, fontSize: 24, bold: true, color: ACCENT });
}

function titleSlide(pptx: any, d: DeckData): void {
  const s = pptx.addSlide();
  s.background = { color: "F5F3EC" };
  s.addText(d.shopName, { x: 0.5, y: 2.2, w: 12.3, h: 0.9, fontSize: 40, bold: true, color: ACCENT, align: "center" });
  s.addText("Sales Analysis", { x: 0.5, y: 3.2, w: 12.3, h: 0.7, fontSize: 28, color: INK, align: "center" });
  s.addText(`Period: ${d.period.label}`, { x: 0.5, y: 4.0, w: 12.3, h: 0.5, fontSize: 18, color: MUTED, align: "center" });
  s.addText(`Generated ${d.generatedAt}`, { x: 0.5, y: 6.6, w: 12.3, h: 0.4, fontSize: 12, color: MUTED, align: "center" });
}

function kpiSlide(pptx: any, d: DeckData): void {
  const s = pptx.addSlide();
  heading(s, "At a glance");
  const avg = d.summary.bills > 0 ? Math.round(d.summary.sales / d.summary.bills) : 0;
  const tiles = [
    { label: "Total sales", value: formatINR(d.summary.sales) },
    { label: "Bills", value: String(d.summary.bills) },
    { label: "GST collected", value: formatINR(d.summary.gst) },
    { label: "Avg bill", value: formatINR(avg) },
  ];
  tiles.forEach((t, i) => {
    const x = 0.5 + i * 3.13;
    s.addShape("roundRect", { x, y: 1.3, w: 2.9, h: 1.6, fill: { color: "FFFFFF" }, line: { color: "DDDDDD", width: 1 }, rectRadius: 0.08 });
    s.addText(t.value, { x, y: 1.5, w: 2.9, h: 0.8, fontSize: 26, bold: true, color: ACCENT, align: "center" });
    s.addText(t.label, { x, y: 2.35, w: 2.9, h: 0.4, fontSize: 13, color: MUTED, align: "center" });
  });

  const pay = `Cash ${formatINR(d.summary.cash)}   ·   UPI ${formatINR(d.summary.upi)}   ·   Card ${formatINR(d.summary.card)}   ·   On credit ${formatINR(d.summary.credit)}`;
  s.addText(pay, { x: 0.5, y: 3.4, w: 12.3, h: 0.5, fontSize: 14, color: INK, align: "center" });

  s.addText("Insights", { x: 0.5, y: 4.1, w: 12.3, h: 0.4, fontSize: 16, bold: true, color: INK });
  s.addText(
    insights(d).map((t) => ({ text: t, options: { bullet: true, fontSize: 14, color: INK, breakLine: true } })),
    { x: 0.7, y: 4.5, w: 12.0, h: 2.5 },
  );
}

function salesTrendSlide(pptx: any, d: DeckData): void {
  const s = pptx.addSlide();
  heading(s, "Sales trend");
  if (d.byDay.length === 0) {
    s.addText("No sales in this period.", { x: 0.5, y: 3, w: 12.3, h: 1, fontSize: 18, color: MUTED, align: "center" });
    return;
  }
  const chartType = d.byDay.length === 1 ? "bar" : "line";
  s.addChart(
    chartType,
    [{ name: "Sales (₹)", labels: d.byDay.map((r) => r.day.slice(5)), values: d.byDay.map((r) => rupees(r.total)) }],
    { x: 0.5, y: 1.2, w: 12.3, h: 5.7, showLegend: false, chartColors: [ACCENT], lineSmooth: true, catAxisLabelFontSize: 10, valAxisLabelFontSize: 10 },
  );
}

function topItemsSlide(pptx: any, d: DeckData): void {
  const s = pptx.addSlide();
  heading(s, "Top items by revenue");
  if (d.top.length === 0) {
    s.addText("No items sold in this period.", { x: 0.5, y: 3, w: 12.3, h: 1, fontSize: 18, color: MUTED, align: "center" });
    return;
  }
  s.addChart(
    "bar",
    [{ name: "Revenue (₹)", labels: d.top.map((t) => t.name), values: d.top.map((t) => rupees(t.revenue)) }],
    { x: 0.5, y: 1.2, w: 12.3, h: 5.7, barDir: "bar", showLegend: false, chartColors: [ACCENT], showValue: true, dataLabelFontSize: 10, catAxisLabelFontSize: 11 },
  );
}

function gstAndPaymentSlide(pptx: any, d: DeckData): void {
  const s = pptx.addSlide();
  heading(s, "GST collected & payment mix");

  if (d.slabs.length > 0) {
    s.addText("GST by slab", { x: 0.5, y: 1.1, w: 6, h: 0.4, fontSize: 15, bold: true, color: INK });
    s.addChart(
      "bar",
      [
        { name: "CGST", labels: d.slabs.map((x) => `${x.rate}%`), values: d.slabs.map((x) => rupees(x.cgst)) },
        { name: "SGST", labels: d.slabs.map((x) => `${x.rate}%`), values: d.slabs.map((x) => rupees(x.sgst)) },
      ],
      { x: 0.4, y: 1.5, w: 6.2, h: 5.2, barGrouping: "stacked", showLegend: true, legendPos: "b", chartColors: [ACCENT, "C77D2E"], catAxisLabelFontSize: 11 },
    );
  }

  const payData = [
    { label: "Cash", value: rupees(d.summary.cash) },
    { label: "UPI", value: rupees(d.summary.upi) },
    { label: "Card", value: rupees(d.summary.card) },
    { label: "Credit", value: rupees(d.summary.credit) },
  ].filter((p) => p.value > 0);
  s.addText("Payment mix", { x: 7.0, y: 1.1, w: 6, h: 0.4, fontSize: 15, bold: true, color: INK });
  if (payData.length > 0) {
    s.addChart(
      "pie",
      [{ name: "Payments", labels: payData.map((p) => p.label), values: payData.map((p) => p.value) }],
      { x: 7.0, y: 1.5, w: 5.8, h: 5.2, showLegend: true, legendPos: "b", showPercent: true, chartColors: PALETTE },
    );
  } else {
    s.addText("No payments recorded.", { x: 7.0, y: 3, w: 5.8, h: 1, fontSize: 16, color: MUTED });
  }
}

function healthSlide(pptx: any, d: DeckData): void {
  const s = pptx.addSlide();
  heading(s, "Stock & credit health");

  s.addText("Needs reordering", { x: 0.5, y: 1.1, w: 6, h: 0.4, fontSize: 15, bold: true, color: INK });
  const stockLines =
    d.lowStock.length === 0
      ? [{ text: "All stock levels healthy.", options: { fontSize: 14, color: MUTED } }]
      : d.lowStock.map((p) => ({
          text: `${p.name} — ${p.out ? "OUT OF STOCK" : `${p.qty} ${p.unit} left`} (reorder ${p.reorder})`,
          options: { bullet: true, fontSize: 13, color: p.out ? "B0413E" : INK, breakLine: true },
        }));
  s.addText(stockLines, { x: 0.7, y: 1.55, w: 6, h: 5 });

  s.addText("Outstanding khata", { x: 7.0, y: 1.1, w: 5.8, h: 0.4, fontSize: 15, bold: true, color: INK });
  const total = d.outstanding.reduce((sum, o) => sum + o.balance, 0);
  const khataLines =
    d.outstanding.length === 0
      ? [{ text: "No outstanding credit.", options: { fontSize: 14, color: MUTED } }]
      : [
          { text: `Total owed: ${formatINR(total)}`, options: { fontSize: 14, bold: true, color: INK, breakLine: true } },
          ...d.outstanding.map((o) => ({
            text: `${o.name} — ${formatINR(o.balance)}`,
            options: { bullet: true, fontSize: 13, color: INK, breakLine: true },
          })),
        ];
  s.addText(khataLines, { x: 7.2, y: 1.55, w: 5.6, h: 5 });
}

function insights(d: DeckData): string[] {
  const out: string[] = [];
  if (d.top[0]) out.push(`Top seller: ${d.top[0].name} (${formatINR(d.top[0].revenue)})`);
  if (d.byDay.length > 0) {
    const best = d.byDay.reduce((a, b) => (b.total > a.total ? b : a));
    out.push(`Busiest day: ${best.day} (${formatINR(best.total)})`);
  }
  out.push(`GST collected: ${formatINR(d.summary.gst)} (CGST ${formatINR(d.summary.cgst)} + SGST ${formatINR(d.summary.sgst)})`);
  if (d.lowStock.length > 0) out.push(`${d.lowStock.length} item(s) need attention (low or out of stock)`);
  const owed = d.outstanding.reduce((s, o) => s + o.balance, 0);
  if (owed > 0) out.push(`Outstanding khata: ${formatINR(owed)} across ${d.outstanding.length} customer(s)`);
  if (out.length === 0) out.push("No activity in this period yet.");
  return out;
}
