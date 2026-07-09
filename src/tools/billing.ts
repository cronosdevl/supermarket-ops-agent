import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { formatINR } from "../db/index.js";
import { computeBill, computeLineGst } from "../domain/gst.js";
import {
  addLine,
  cancelDraft,
  finalizeDraft,
  getBillWithItems,
  getOpenDraftWithItems,
  removeLine,
  setLineQty,
  type Bill,
  type BillItem,
} from "../db/bills.js";
import { StoreError } from "../util/errors.js";
import { guard, text } from "./_shared.js";
import type { ToolContext } from "./context.js";

const MEASURED = new Set(["kg", "g", "litre", "ml"]);
function qtyLabel(qty: number, unit: string): string {
  return MEASURED.has(unit) ? `${qty} ${unit}` : `${qty}`;
}

/** Render a bill (draft preview or final) with a legible GST breakup. */
function formatBill(bill: Bill, items: BillItem[]): string {
  const isDraft = bill.status === "draft";
  const lines = [`🧾 Bill #${bill.id} — ${bill.status.toUpperCase()}`];

  if (items.length === 0) {
    lines.push("(no items yet)");
    return lines.join("\n");
  }

  for (const it of items) {
    const gross = computeLineGst(it.unit_price, it.qty, it.gst_rate).gross;
    lines.push(
      `• ${it.name} — ${qtyLabel(it.qty, it.unit)} @ ${formatINR(it.unit_price)} = ${formatINR(gross)}` +
        ` (GST ${it.gst_rate}%)`,
    );
  }

  const t = computeBill(items);
  lines.push("");
  lines.push("Tax breakup:");
  for (const s of t.byRate) {
    if (s.rate === 0) {
      lines.push(`  0% (exempt) on ${formatINR(s.taxable)}`);
    } else {
      lines.push(
        `  ${s.rate}% on ${formatINR(s.taxable)} → CGST ${formatINR(s.cgst)} + SGST ${formatINR(s.sgst)}`,
      );
    }
  }
  lines.push("");
  lines.push(`Taxable value: ${formatINR(t.subtotal)}`);
  lines.push(`CGST: ${formatINR(t.cgst)}   SGST: ${formatINR(t.sgst)}`);
  lines.push(`Total payable: ${formatINR(t.total)}`);

  if (!isDraft) {
    if (bill.on_credit) {
      lines.push(`On credit (khata): ${bill.customer_name}`);
    } else {
      const pay = bill.payment_mode?.toUpperCase() + (bill.payment_ref ? ` (ref ${bill.payment_ref})` : "");
      lines.push(`Paid by: ${pay}`);
    }
  }
  return lines.join("\n");
}

export function billingTools(ctx: ToolContext) {
  const addLineItem = tool(
    "add_line_item",
    "Add a product (and quantity) to the current bill, creating a new draft bill " +
      "if none is open. If the same product is already on the bill, the quantities " +
      "are combined. Use this while building a bill. Does NOT decrement stock — that " +
      "only happens at finalize.",
    {
      product: z.string().describe("Product name or code, e.g. 'Maggi' or 'Aashirvaad Atta 5kg'"),
      qty: z
        .number()
        .positive()
        .describe("Quantity in the product's unit (e.g. 2 for 2kg loose, 4 for 4 packets)"),
    },
    async (a) =>
      guard(() => {
        const r = addLine(ctx.chatId, a.product, a.qty);
        const warn =
          a.qty > r.availableQty
            ? `  ⚠️ heads-up: only ${r.availableQty} ${r.unit} in stock — finalize will fail unless you restock or lower the qty.`
            : "";
        return text(
          `Added to bill #${r.bill.id}: ${r.name} × ${qtyLabel(r.qty, r.unit)} @ ${formatINR(r.unit_price)}.${warn}`,
        );
      }),
  );

  const updateLineItem = tool(
    "update_line_item",
    "Set the quantity of an item already on the current bill to an absolute value " +
      "(e.g. 'make it 6 Maggi' → qty 6). To add more on top instead, use add_line_item. " +
      "To remove an item, use remove_line_item.",
    {
      product: z.string().describe("Product name or code already on the bill"),
      qty: z.number().positive().describe("New absolute quantity for that line"),
    },
    async (a) =>
      guard(() => {
        const line = setLineQty(ctx.chatId, a.product, a.qty);
        return text(`Updated: ${line.name} is now ${qtyLabel(line.qty, line.unit)} on the bill.`);
      }),
  );

  const removeLineItem = tool(
    "remove_line_item",
    "Remove an item from the current bill entirely ('drop the butter').",
    {
      product: z.string().describe("Product name or code to remove from the bill"),
    },
    async (a) =>
      guard(() => {
        const { name } = removeLine(ctx.chatId, a.product);
        return text(`Removed ${name} from the bill.`);
      }),
  );

  const viewBill = tool(
    "view_bill",
    "Show the current draft bill (default) with its running total and GST breakup, " +
      "or a specific bill by id. Use before finalizing, or to re-show a past bill.",
    {
      bill_id: z.number().optional().describe("A specific bill id to view; omit for the current draft"),
    },
    async (a) =>
      guard(() => {
        const bwi = a.bill_id != null ? getBillWithItems(a.bill_id) : getOpenDraftWithItems(ctx.chatId);
        if (!bwi) {
          return text(a.bill_id != null ? `No bill #${a.bill_id} found.` : "No open bill right now.");
        }
        return text(formatBill(bwi.bill, bwi.items));
      }),
  );

  const finalizeBill = tool(
    "finalize_bill",
    "Finalize the current draft: check stock (refuses if any item would oversell), " +
      "decrement stock atomically, compute the GST-correct totals, and settle it. " +
      "Settle EITHER by immediate payment (set payment_mode) OR on credit (set " +
      "credit_customer to put the total on that customer's khata) — not both. After " +
      "this the bill is locked.",
    {
      payment_mode: z
        .enum(["cash", "upi", "card"])
        .optional()
        .describe("How the customer paid now. Omit if putting the bill on khata."),
      payment_ref: z
        .string()
        .optional()
        .describe("Optional payment reference (UPI txn id, card last-4, etc.)"),
      credit_customer: z
        .string()
        .optional()
        .describe(
          "Customer name if this is a credit (khata) sale — the total is added to their khata instead of taking payment. Opens a khata if they're new.",
        ),
    },
    async (a) =>
      guard(() => {
        if (a.payment_mode && a.credit_customer) {
          throw new StoreError("Take payment OR put it on khata — not both.");
        }
        const settlement = a.credit_customer
          ? ({ type: "credit", customer: a.credit_customer } as const)
          : a.payment_mode
            ? ({ type: "paid", mode: a.payment_mode, ref: a.payment_ref } as const)
            : null;
        if (!settlement) {
          throw new StoreError("How is it settled — cash, UPI, card, or on someone's khata?");
        }
        const { bill, items } = finalizeDraft({ chatId: ctx.chatId, settlement });
        return text(`✅ Bill finalized.\n\n${formatBill(bill, items)}`);
      }),
  );

  const cancelBill = tool(
    "cancel_bill",
    "Discard the current draft bill without finalizing. Safe — no stock was touched.",
    {},
    async () =>
      guard(() => {
        const { id } = cancelDraft(ctx.chatId);
        return text(`Cancelled draft bill #${id}.`);
      }),
  );

  return [addLineItem, updateLineItem, removeLineItem, viewBill, finalizeBill, cancelBill];
}
