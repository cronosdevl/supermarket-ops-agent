/**
 * GST maths. All money is INTEGER paise so results are exact and reproducible.
 *
 * Indian retail convention: the printed MRP is GST-INCLUSIVE. So for each line
 * the customer pays `mrp × qty` (the "gross"), and we back OUT the tax to show a
 * correct breakup:
 *
 *   gross   = round(unit_price × qty)          // what the customer pays
 *   taxable = round(gross × 100 / (100 + rate))// ex-GST value
 *   tax     = gross − taxable                   // total GST on the line
 *   cgst    = floor(tax / 2)                     // intra-state: split evenly
 *   sgst    = tax − cgst                         // remainder keeps the sum exact
 *
 * Invariant per line: taxable + cgst + sgst === gross (no paise ever lost).
 */

export interface LineInput {
  unit_price: number; // paise per unit (GST-inclusive MRP)
  qty: number; // may be fractional for loose items
  gst_rate: number; // percent
}

export interface LineGst {
  gross: number;
  taxable: number;
  tax: number;
  cgst: number;
  sgst: number;
}

export function computeLineGst(unitPrice: number, qty: number, rate: number): LineGst {
  const gross = Math.round(unitPrice * qty);
  if (rate <= 0) {
    return { gross, taxable: gross, tax: 0, cgst: 0, sgst: 0 };
  }
  const taxable = Math.round((gross * 100) / (100 + rate));
  const tax = gross - taxable;
  const cgst = Math.floor(tax / 2);
  const sgst = tax - cgst;
  return { gross, taxable, tax, cgst, sgst };
}

export interface SlabBreakup {
  rate: number;
  taxable: number;
  cgst: number;
  sgst: number;
}

export interface BillTotals {
  subtotal: number; // sum of taxable values (ex-GST)
  cgst: number;
  sgst: number;
  total: number; // sum of gross = payable
  byRate: SlabBreakup[]; // legible tax breakup, one row per GST slab present
}

/** Aggregate a set of lines into bill totals and a per-slab tax breakup. */
export function computeBill(lines: LineInput[]): BillTotals {
  let subtotal = 0,
    cgst = 0,
    sgst = 0,
    total = 0;
  const slabs = new Map<number, SlabBreakup>();

  for (const line of lines) {
    const g = computeLineGst(line.unit_price, line.qty, line.gst_rate);
    subtotal += g.taxable;
    cgst += g.cgst;
    sgst += g.sgst;
    total += g.gross;

    const slab = slabs.get(line.gst_rate) ?? { rate: line.gst_rate, taxable: 0, cgst: 0, sgst: 0 };
    slab.taxable += g.taxable;
    slab.cgst += g.cgst;
    slab.sgst += g.sgst;
    slabs.set(line.gst_rate, slab);
  }

  const byRate = [...slabs.values()].sort((a, b) => a.rate - b.rate);
  return { subtotal, cgst, sgst, total, byRate };
}

/** Round a paise amount to the nearest rupee; returns the rounded value and the
 *  round-off adjustment (payable − exact), both in paise. Used on invoices. */
export function roundToRupee(totalPaise: number): { payable: number; roundOff: number } {
  const payable = Math.round(totalPaise / 100) * 100;
  return { payable, roundOff: payable - totalPaise };
}
