import { db } from "./index.js";
import { StoreError } from "../util/errors.js";
import { computeLineGst } from "../domain/gst.js";
import { getProductBySku, resolveProduct } from "./products.js";
import { chargeRaw } from "./khata.js";

export interface Bill {
  id: number;
  status: "draft" | "final" | "void";
  payment_mode: "cash" | "upi" | "card" | null;
  payment_ref: string | null;
  customer_name: string | null;
  on_credit: number;
  subtotal: number;
  cgst: number;
  sgst: number;
  total: number;
  chat_id: number | null;
  created_at: string;
  finalized_at: string | null;
}

export interface BillItem {
  id: number;
  bill_id: number;
  sku: string;
  name: string;
  unit: string;
  qty: number;
  unit_price: number; // paise, GST-inclusive MRP snapshot
  gst_rate: number;
  hsn: string;
  line_taxable: number;
  line_cgst: number;
  line_sgst: number;
  line_total: number;
}

export type PaymentMode = "cash" | "upi" | "card";

// ---- statements ------------------------------------------------------------

const openDraftStmt = db.prepare(
  "SELECT * FROM bills WHERE chat_id = ? AND status = 'draft' ORDER BY id DESC LIMIT 1",
);
const billByIdStmt = db.prepare("SELECT * FROM bills WHERE id = ?");
const itemsByBillStmt = db.prepare("SELECT * FROM bill_items WHERE bill_id = ? ORDER BY id");
const createDraftStmt = db.prepare("INSERT INTO bills (status, chat_id) VALUES ('draft', ?)");
const lineBySkuStmt = db.prepare("SELECT * FROM bill_items WHERE bill_id = ? AND sku = ?");
const insertLineStmt = db.prepare(`
  INSERT INTO bill_items (bill_id, sku, name, unit, qty, unit_price, gst_rate, hsn)
  VALUES (@bill_id, @sku, @name, @unit, @qty, @unit_price, @gst_rate, @hsn)
`);
const bumpLineQtyStmt = db.prepare("UPDATE bill_items SET qty = qty + @add WHERE id = @id");
const setLineQtyStmt = db.prepare("UPDATE bill_items SET qty = @qty WHERE id = @id");
const deleteLineStmt = db.prepare("DELETE FROM bill_items WHERE bill_id = @bill_id AND sku = @sku");
const finalizeLineStmt = db.prepare(`
  UPDATE bill_items
  SET line_taxable = @taxable, line_cgst = @cgst, line_sgst = @sgst, line_total = @total
  WHERE id = @id
`);
// Oversell guard: decrement ONLY if enough stock. changes===0 means short.
const decStockStmt = db.prepare(
  `UPDATE products SET qty = qty - @need, updated_at = datetime('now')
   WHERE sku = @sku AND qty >= @need`,
);
const finalizeBillStmt = db.prepare(`
  UPDATE bills
  SET status = 'final', payment_mode = @payment_mode, payment_ref = @payment_ref,
      customer_name = @customer_name, on_credit = @on_credit,
      subtotal = @subtotal, cgst = @cgst, sgst = @sgst, total = @total,
      finalized_at = datetime('now')
  WHERE id = @id
`);
const voidBillStmt = db.prepare("UPDATE bills SET status = 'void' WHERE id = @id");

// ---- reads -----------------------------------------------------------------

export function getOpenDraft(chatId: number): Bill | undefined {
  return openDraftStmt.get(chatId) as Bill | undefined;
}
export function getBillById(id: number): Bill | undefined {
  return billByIdStmt.get(id) as Bill | undefined;
}
const latestFinalStmt = db.prepare(
  "SELECT * FROM bills WHERE status = 'final' ORDER BY finalized_at DESC, id DESC LIMIT 1",
);
export function getLatestFinalBill(): Bill | undefined {
  return latestFinalStmt.get() as Bill | undefined;
}
export function getBillItems(billId: number): BillItem[] {
  return itemsByBillStmt.all(billId) as BillItem[];
}
export interface BillWithItems {
  bill: Bill;
  items: BillItem[];
}
export function getOpenDraftWithItems(chatId: number): BillWithItems | undefined {
  const bill = getOpenDraft(chatId);
  return bill ? { bill, items: getBillItems(bill.id) } : undefined;
}
export function getBillWithItems(id: number): BillWithItems | undefined {
  const bill = getBillById(id);
  return bill ? { bill, items: getBillItems(bill.id) } : undefined;
}

// ---- draft building --------------------------------------------------------

/** Get the chat's open draft, creating one if needed. Call inside a transaction. */
function ensureDraft(chatId: number): Bill {
  const existing = getOpenDraft(chatId);
  if (existing) return existing;
  const res = createDraftStmt.run(chatId);
  return getBillById(Number(res.lastInsertRowid))!;
}

export interface AddLineResult {
  bill: Bill;
  sku: string;
  name: string;
  unit: string;
  qty: number; // resulting qty on the line
  unit_price: number;
  availableQty: number; // current stock (for a soft warning; NOT a hard block here)
}

/**
 * Add a product to the chat's draft (creating the draft if needed). If the same
 * product is already on the bill, quantities are merged. Stock is NOT reserved
 * or decremented here — that happens only at finalize (hard-part §4).
 */
export const addLine = db.transaction((chatId: number, productQuery: string, qty: number): AddLineResult => {
  if (qty <= 0) throw new StoreError("Quantity must be greater than zero.");
  const product = resolveProduct(productQuery); // throws on miss/ambiguity
  const draft = ensureDraft(chatId);

  const existing = lineBySkuStmt.get(draft.id, product.sku) as BillItem | undefined;
  let resultingQty: number;
  if (existing) {
    bumpLineQtyStmt.run({ add: qty, id: existing.id });
    resultingQty = existing.qty + qty;
  } else {
    insertLineStmt.run({
      bill_id: draft.id,
      sku: product.sku,
      name: product.name,
      unit: product.unit,
      qty,
      unit_price: product.mrp,
      gst_rate: product.gst_rate,
      hsn: product.hsn,
    });
    resultingQty = qty;
  }

  return {
    bill: getBillById(draft.id)!,
    sku: product.sku,
    name: product.name,
    unit: product.unit,
    qty: resultingQty,
    unit_price: product.mrp,
    availableQty: product.qty,
  };
});

/** Set an existing line's quantity to an absolute value ("make it 6 Maggi"). */
export const setLineQty = db.transaction((chatId: number, productQuery: string, qty: number): BillItem => {
  if (qty <= 0) throw new StoreError("Quantity must be greater than zero. To drop it, remove the item.");
  const draft = getOpenDraft(chatId);
  if (!draft) throw new StoreError("There's no open bill to edit.");
  const product = resolveProduct(productQuery);
  const line = lineBySkuStmt.get(draft.id, product.sku) as BillItem | undefined;
  if (!line) throw new StoreError(`${product.name} isn't on the current bill.`);
  setLineQtyStmt.run({ qty, id: line.id });
  return lineBySkuStmt.get(draft.id, product.sku) as BillItem;
});

/** Remove a line from the draft ("drop the butter"). */
export const removeLine = db.transaction((chatId: number, productQuery: string): { name: string } => {
  const draft = getOpenDraft(chatId);
  if (!draft) throw new StoreError("There's no open bill to edit.");
  const product = resolveProduct(productQuery);
  const res = deleteLineStmt.run({ bill_id: draft.id, sku: product.sku });
  if (res.changes === 0) throw new StoreError(`${product.name} isn't on the current bill.`);
  return { name: product.name };
});

/** Discard the chat's open draft (marks it void). Nothing was decremented, so this is safe. */
export const cancelDraft = db.transaction((chatId: number): { id: number } => {
  const draft = getOpenDraft(chatId);
  if (!draft) throw new StoreError("There's no open bill to cancel.");
  voidBillStmt.run({ id: draft.id });
  return { id: draft.id };
});

// ---- finalize --------------------------------------------------------------

/** How a finalized bill is settled: paid now (cash/upi/card) or put on khata. */
export type Settlement =
  { type: "paid"; mode: PaymentMode; ref?: string } | { type: "credit"; customer: string };

export interface FinalizeInput {
  chatId: number;
  settlement: Settlement;
}

/**
 * Finalize the chat's open draft in ONE transaction:
 *  - refuse below-cost lines (guardrail),
 *  - oversell guard + atomic stock decrement per line (any shortfall rolls the
 *    whole thing back — no partial decrements),
 *  - compute & persist GST breakup,
 *  - settle: record payment, OR add the total to the customer's khata (opening
 *    the account if new) as a charge linked to this bill,
 *  - flip status draft→final.
 *
 * Idempotency (§5): finalize consumes the draft (draft→final). A retried
 * finalize finds no open draft, so stock/khata can never be applied twice.
 */
export const finalizeDraft = db.transaction((input: FinalizeInput): BillWithItems => {
  const draft = getOpenDraft(input.chatId);
  if (!draft) throw new StoreError("There's no open bill to finalize.");
  const items = getBillItems(draft.id);
  if (items.length === 0) throw new StoreError("The bill is empty — add items before finalizing.");

  let subtotal = 0,
    cgst = 0,
    sgst = 0,
    total = 0;

  for (const item of items) {
    const product = getProductBySku(item.sku);
    if (!product) throw new StoreError(`${item.name} is no longer in the catalogue.`);
    if (product.cost_price > 0 && item.unit_price < product.cost_price) {
      throw new StoreError(`${item.name} would sell below cost — refusing.`);
    }
    const dec = decStockStmt.run({ need: item.qty, sku: item.sku });
    if (dec.changes !== 1) {
      throw new StoreError(
        `Not enough ${product.name} — only ${product.qty} ${product.unit} in stock, ` +
          `bill needs ${item.qty}. Reduce the quantity or receive stock first.`,
      );
    }
    const g = computeLineGst(item.unit_price, item.qty, item.gst_rate);
    finalizeLineStmt.run({ taxable: g.taxable, cgst: g.cgst, sgst: g.sgst, total: g.gross, id: item.id });
    subtotal += g.taxable;
    cgst += g.cgst;
    sgst += g.sgst;
    total += g.gross;
  }

  if (input.settlement.type === "credit") {
    // Opens the khata if the customer is new; charge is linked to this bill.
    const { customer } = chargeRaw(input.settlement.customer, total, {
      note: `Bill #${draft.id}`,
      billId: draft.id,
    });
    finalizeBillStmt.run({
      id: draft.id,
      payment_mode: null,
      payment_ref: null,
      customer_name: customer.name,
      on_credit: 1,
      subtotal,
      cgst,
      sgst,
      total,
    });
  } else {
    finalizeBillStmt.run({
      id: draft.id,
      payment_mode: input.settlement.mode,
      payment_ref: input.settlement.ref ?? null,
      customer_name: null,
      on_credit: 0,
      subtotal,
      cgst,
      sgst,
      total,
    });
  }

  return getBillWithItems(draft.id)!;
});
