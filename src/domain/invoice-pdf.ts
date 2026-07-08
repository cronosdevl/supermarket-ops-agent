import pdfmake from "pdfmake";
import robotoFonts from "pdfmake/fonts/Roboto.js";
import { formatINR } from "../db/index.js";
import type { Bill, BillItem } from "../db/bills.js";
import type { ShopConfig } from "../db/shop.js";
import { computeBill, computeLineGst, roundToRupee } from "./gst.js";
import { rupeesInWords } from "./words.js";

let fontsReady = false;
function ensureFonts(): void {
  if (fontsReady) return;
  pdfmake.setLocalAccessPolicy(() => true); // allow reading the bundled Roboto TTFs
  pdfmake.setUrlAccessPolicy(() => false); // never fetch remote resources
  pdfmake.addFonts(robotoFonts);
  fontsReady = true;
}

const MEASURED = new Set(["kg", "g", "litre", "ml"]);
const qtyLabel = (qty: number, unit: string) => (MEASURED.has(unit) ? `${qty} ${unit}` : `${qty}`);
const money = (p: number) => formatINR(p);

export interface InvoiceData {
  bill: Bill;
  items: BillItem[];
  shop: ShopConfig;
}

/** Render a clean, GST-correct A4 tax invoice as a PDF buffer. */
export async function renderInvoicePdf({ bill, items, shop }: InvoiceData): Promise<Buffer> {
  ensureFonts();

  const totals = computeBill(items);
  const { payable, roundOff } = roundToRupee(totals.total);
  const invoiceDate = (bill.finalized_at ?? bill.created_at).slice(0, 16).replace("T", " ");

  // Line items table
  const itemHeader = ["#", "Item", "HSN", "Qty", "Rate", "GST%", "Taxable", "Amount"].map((t) => ({
    text: t,
    style: "th",
  }));
  const itemRows = items.map((it, i) => {
    const gross = computeLineGst(it.unit_price, it.qty, it.gst_rate).gross;
    const taxable = computeLineGst(it.unit_price, it.qty, it.gst_rate).taxable;
    return [
      { text: String(i + 1), alignment: "center" },
      { text: it.name },
      { text: it.hsn || "—", alignment: "center" },
      { text: qtyLabel(it.qty, it.unit), alignment: "center" },
      { text: money(it.unit_price), alignment: "right" },
      { text: `${it.gst_rate}%`, alignment: "center" },
      { text: money(taxable), alignment: "right" },
      { text: money(gross), alignment: "right" },
    ];
  });

  // Tax summary by slab
  const taxHeader = ["Taxable", "GST%", "CGST", "SGST", "Total Tax"].map((t) => ({ text: t, style: "th" }));
  const taxRows = totals.byRate.map((s) => [
    { text: money(s.taxable), alignment: "right" },
    { text: `${s.rate}%`, alignment: "center" },
    { text: money(s.cgst), alignment: "right" },
    { text: money(s.sgst), alignment: "right" },
    { text: money(s.cgst + s.sgst), alignment: "right" },
  ]);
  taxRows.push([
    { text: money(totals.subtotal), alignment: "right", bold: true } as never,
    { text: "", alignment: "center" } as never,
    { text: money(totals.cgst), alignment: "right", bold: true } as never,
    { text: money(totals.sgst), alignment: "right", bold: true } as never,
    { text: money(totals.cgst + totals.sgst), alignment: "right", bold: true } as never,
  ]);

  const settlement = bill.on_credit
    ? `On credit (khata): ${bill.customer_name ?? ""}`
    : `Paid by: ${bill.payment_mode?.toUpperCase() ?? "—"}${bill.payment_ref ? ` (ref ${bill.payment_ref})` : ""}`;

  const docDefinition = {
    pageSize: "A4",
    pageMargins: [40, 40, 40, 55],
    defaultStyle: { font: "Roboto", fontSize: 9 },
    styles: {
      shopName: { fontSize: 16, bold: true },
      title: { fontSize: 14, bold: true, alignment: "right" },
      th: { bold: true, fillColor: "#f0f0f0", margin: [0, 2, 0, 2] },
      small: { fontSize: 8, color: "#555" },
    },
    content: [
      {
        columns: [
          {
            width: "*",
            stack: [
              { text: shop.name || "My Kirana Store", style: "shopName" },
              ...(shop.address ? [{ text: shop.address, style: "small" }] : []),
              ...(shop.phone ? [{ text: `Phone: ${shop.phone}`, style: "small" }] : []),
              ...(shop.gstin ? [{ text: `GSTIN: ${shop.gstin}`, style: "small" }] : []),
              ...(shop.state ? [{ text: `State: ${shop.state}`, style: "small" }] : []),
            ],
          },
          {
            width: "auto",
            stack: [
              { text: "TAX INVOICE", style: "title" },
              { text: `Invoice #: ${bill.id}`, alignment: "right" },
              { text: `Date: ${invoiceDate}`, alignment: "right" },
            ],
          },
        ],
      },
      { canvas: [{ type: "line", x1: 0, y1: 8, x2: 515, y2: 8, lineWidth: 1, lineColor: "#999" }] },
      ...(bill.on_credit && bill.customer_name
        ? [{ text: `Bill to: ${bill.customer_name}`, margin: [0, 8, 0, 0], bold: true }]
        : []),
      {
        margin: [0, 12, 0, 0],
        table: {
          headerRows: 1,
          widths: [16, "*", 40, 40, 55, 30, 60, 60],
          body: [itemHeader, ...itemRows],
        },
        layout: "lightHorizontalLines",
      },
      { text: "Tax summary (intra-state: CGST + SGST)", bold: true, margin: [0, 16, 0, 4] },
      {
        table: { headerRows: 1, widths: [70, 35, 65, 65, 70], body: [taxHeader, ...taxRows] },
        layout: "lightHorizontalLines",
      },
      {
        margin: [0, 12, 0, 0],
        columns: [
          { width: "*", text: "" },
          {
            width: 220,
            stack: [
              row("Taxable value", money(totals.subtotal)),
              row("CGST", money(totals.cgst)),
              row("SGST", money(totals.sgst)),
              ...(roundOff !== 0 ? [row("Round off", money(roundOff))] : []),
              { canvas: [{ type: "line", x1: 0, y1: 2, x2: 220, y2: 2, lineWidth: 0.5, lineColor: "#999" }] },
              row("Grand Total", money(payable), true),
            ],
          },
        ],
      },
      { text: rupeesInWords(payable), margin: [0, 10, 0, 0], italics: true },
      { text: settlement, margin: [0, 8, 0, 0], bold: true },
    ],
    footer: {
      text: "Thank you! This is a computer-generated invoice.",
      style: "small",
      alignment: "center",
      margin: [0, 12, 0, 0],
    },
  };

  const pdf = pdfmake.createPdf(docDefinition);
  return pdf.getBuffer();
}

/** A right-aligned label/value line for the totals block. */
function row(label: string, value: string, bold = false) {
  return {
    columns: [
      { text: label, bold },
      { text: value, alignment: "right", bold },
    ],
    margin: [0, 1, 0, 1],
  };
}
