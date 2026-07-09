import fs from "node:fs";
import path from "node:path";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { config } from "../util/config.js";
import { formatINR } from "../db/index.js";
import { getBillWithItems, getLatestFinalBill } from "../db/bills.js";
import { getShopConfig } from "../db/shop.js";
import type { PeriodKind } from "../db/analytics.js";
import { renderInvoicePdf } from "../domain/invoice-pdf.js";
import { renderAnalysisDeck } from "../domain/analysis-deck.js";
import { buildDeckData } from "../domain/deck-data.js";
import { StoreError } from "../util/errors.js";
import { guard, text } from "./_shared.js";
import type { ToolContext } from "./context.js";

/** Write a generated file to the artifacts dir and queue it for Telegram delivery. */
function saveArtifact(ctx: ToolContext, filename: string, buffer: Buffer, caption?: string): string {
  fs.mkdirSync(config.artifactsDir, { recursive: true });
  const filePath = path.join(config.artifactsDir, filename);
  fs.writeFileSync(filePath, buffer);
  ctx.attachments.push({ path: filePath, filename, caption });
  return filePath;
}

export function documentTools(ctx: ToolContext) {
  const generateInvoice = tool(
    "generate_invoice_pdf",
    "Generate a clean, GST-correct PDF tax invoice for a finalized bill and send " +
      "it to the owner. Pass a bill id, or omit it to invoice the most recent " +
      "finalized bill ('send me that bill as a PDF'). Only finalized bills can be invoiced.",
    {
      bill_id: z.number().optional().describe("Bill id to invoice; omit for the latest finalized bill"),
    },
    async (a) =>
      guard(async () => {
        const bwi = a.bill_id != null ? getBillWithItems(a.bill_id) : bwiFromLatest();
        if (!bwi) {
          throw new StoreError(
            a.bill_id != null ? `No bill #${a.bill_id} found.` : "No finalized bill yet to invoice.",
          );
        }
        if (bwi.bill.status !== "final") {
          throw new StoreError(`Bill #${bwi.bill.id} is still a draft — finalize it first.`);
        }
        const buffer = await renderInvoicePdf({ bill: bwi.bill, items: bwi.items, shop: getShopConfig() });
        const filename = `Invoice-${bwi.bill.id}.pdf`;
        saveArtifact(ctx, filename, buffer, `Invoice #${bwi.bill.id}`);
        return text(`🧾 Invoice #${bwi.bill.id} ready — ${formatINR(bwi.bill.total)}. Sending it as a PDF.`);
      }),
  );

  const generateDeck = tool(
    "generate_analysis_deck",
    "Generate a PowerPoint (.pptx) sales-analysis deck with real charts — sales " +
      "trend, top items, GST collected, payment mix, and stock/credit health — and " +
      "send it to the owner ('make this week's sales analysis deck'). Choose the period.",
    {
      period: z
        .enum(["today", "week", "month", "all"])
        .optional()
        .describe("Analysis window; defaults to 'week' (last 7 days)"),
    },
    async (a) =>
      guard(async () => {
        const kind: PeriodKind = a.period ?? "week";
        const data = buildDeckData(kind);

        const filename = `Sales-Analysis-${kind}.pptx`;
        const filePath = path.join(config.artifactsDir, filename);
        fs.mkdirSync(config.artifactsDir, { recursive: true });
        await renderAnalysisDeck(data, filePath);

        ctx.attachments.push({ path: filePath, filename, caption: `Sales analysis — ${data.period.label}` });
        const s = data.summary;
        return text(
          `📊 Sales analysis deck for ${data.period.label} ready — ${s.bills} bill(s), ` +
            `${formatINR(s.sales)} sales, ${formatINR(s.gst)} GST. Sending the PPTX.`,
        );
      }),
  );

  return [generateInvoice, generateDeck];
}

function bwiFromLatest() {
  const latest = getLatestFinalBill();
  return latest ? getBillWithItems(latest.id) : undefined;
}
