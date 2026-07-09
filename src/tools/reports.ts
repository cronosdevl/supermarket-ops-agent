import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { formatINR } from "../db/index.js";
import { resolvePeriod, salesSummary, topItems, type PeriodKind } from "../db/analytics.js";
import { guard, text } from "./_shared.js";

/** Daily-close / sales-report tools (read-only). */
export function reportsTools() {
  const salesReport = tool(
    "sales_report",
    "Summarise sales for a period — answers 'today's sales?', 'close the day', or " +
      "'this week's numbers'. Reports total sales, tax collected (CGST/SGST), the " +
      "cash vs UPI vs card vs credit split, and top items. Defaults to today.",
    {
      period: z
        .enum(["today", "week", "month", "all"])
        .optional()
        .describe("Reporting window; defaults to 'today'"),
    },
    async (a) =>
      guard(() => {
        const kind: PeriodKind = a.period ?? "today";
        const period = resolvePeriod(kind);
        const s = salesSummary(period);

        if (s.bills === 0) return text(`No sales ${period.label} yet.`);

        const avg = Math.round(s.sales / s.bills);
        const top = topItems(period, 5);
        const lines = [
          `📊 Sales — ${period.label}`,
          `Bills: ${s.bills} · Total: ${formatINR(s.sales)} · Avg bill: ${formatINR(avg)}`,
          `Tax collected: ${formatINR(s.gst)} (CGST ${formatINR(s.cgst)} + SGST ${formatINR(s.sgst)})`,
          `Payments — Cash ${formatINR(s.cash)} · UPI ${formatINR(s.upi)} · Card ${formatINR(s.card)} · On credit ${formatINR(s.credit)}`,
        ];
        if (top.length > 0) {
          lines.push("Top items:");
          for (const t of top) lines.push(`• ${t.name} — ${t.qty} sold (${formatINR(t.revenue)})`);
        }
        return text(lines.join("\n"));
      }),
  );

  return [salesReport];
}
