import { db } from "./index.js";
import { StoreError } from "../util/errors.js";

/**
 * Khata = the shop's credit ledger. Balance is derived, never stored: it's the
 * running sum of ledger deltas (paise). Convention:
 *   charge  -> delta = +amount  (customer owes more)
 *   payment -> delta = -amount  (customer owes less)
 *   balance > 0  customer owes the shop
 *   balance < 0  customer is in advance (shop owes them)
 *
 * Guardrail (§7): you can't settle or query a khata that doesn't exist. A charge
 * may open a new account (extending credit to a new customer is legitimate); a
 * payment or balance query on an unknown customer is refused.
 */

export interface Customer {
  id: number;
  name: string;
  name_key: string;
  created_at: string;
}

export interface Debtor {
  customer: Customer;
  balance: number; // paise, signed
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

const byNameKeyStmt = db.prepare("SELECT * FROM khata_customers WHERE name_key = ?");
const insertCustomerStmt = db.prepare(
  "INSERT INTO khata_customers (name, name_key) VALUES (@name, @name_key)",
);
const balanceStmt = db.prepare(
  "SELECT COALESCE(SUM(delta), 0) AS bal FROM khata_ledger WHERE customer_id = ?",
);
const insertLedgerStmt = db.prepare(`
  INSERT INTO khata_ledger (customer_id, delta, kind, note, bill_id)
  VALUES (@customer_id, @delta, @kind, @note, @bill_id)
`);
const outstandingStmt = db.prepare(`
  SELECT c.id, c.name, c.name_key, c.created_at,
         COALESCE(SUM(l.delta), 0) AS bal
  FROM khata_customers c
  LEFT JOIN khata_ledger l ON l.customer_id = c.id
  GROUP BY c.id
  HAVING bal <> 0
  ORDER BY bal DESC, c.name
`);

export function getCustomerByName(name: string): Customer | undefined {
  return byNameKeyStmt.get(normalizeName(name)) as Customer | undefined;
}

export function getBalance(customerId: number): number {
  return (balanceStmt.get(customerId) as { bal: number }).bal;
}

function getOrCreateCustomer(name: string): Customer {
  const trimmed = name.trim();
  if (!trimmed) throw new StoreError("A customer name is needed for khata.");
  const existing = getCustomerByName(trimmed);
  if (existing) return existing;
  const res = insertCustomerStmt.run({ name: trimmed, name_key: normalizeName(trimmed) });
  return byNameKeyStmt.get(normalizeName(trimmed)) as Customer;
}

export interface LedgerResult {
  customer: Customer;
  balance: number;
}

/** Raw charge (no transaction wrapper) — safe to compose inside another tx
 *  (e.g. a credit-sale finalize). Opens the account if the customer is new. */
export function chargeRaw(
  name: string,
  amountPaise: number,
  opts: { note?: string; billId?: number } = {},
): LedgerResult {
  if (amountPaise <= 0) throw new StoreError("Charge amount must be greater than ₹0.");
  const customer = getOrCreateCustomer(name);
  insertLedgerStmt.run({
    customer_id: customer.id,
    delta: amountPaise,
    kind: "charge",
    note: opts.note ?? null,
    bill_id: opts.billId ?? null,
  });
  return { customer, balance: getBalance(customer.id) };
}

/** Raw payment (no transaction wrapper). Refuses if the customer has no khata. */
export function paymentRaw(name: string, amountPaise: number, note?: string): LedgerResult {
  if (amountPaise <= 0) throw new StoreError("Payment amount must be greater than ₹0.");
  const customer = getCustomerByName(name);
  if (!customer) {
    throw new StoreError(`No khata for "${name.trim()}" — nothing to settle. Open one with a credit charge first.`);
  }
  insertLedgerStmt.run({
    customer_id: customer.id,
    delta: -amountPaise,
    kind: "payment",
    note: note ?? null,
    bill_id: null,
  });
  return { customer, balance: getBalance(customer.id) };
}

// Public, transaction-wrapped API for the tools.
export const charge = db.transaction(chargeRaw);
export const payment = db.transaction(paymentRaw);

/** Balance for a named customer. Refuses if the customer has no khata. */
export function balanceOf(name: string): LedgerResult {
  const customer = getCustomerByName(name);
  if (!customer) throw new StoreError(`No khata account for "${name.trim()}".`);
  return { customer, balance: getBalance(customer.id) };
}

/** All customers with a non-zero balance (debtors and advances). */
export function listOutstanding(): Debtor[] {
  const rows = outstandingStmt.all() as (Customer & { bal: number })[];
  return rows.map((r) => ({
    customer: { id: r.id, name: r.name, name_key: r.name_key, created_at: r.created_at },
    balance: r.bal,
  }));
}
