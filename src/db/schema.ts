/**
 * Full store schema (all phases). Idempotent — safe to run on every boot.
 *
 * Money is stored as INTEGER paise (₹1 = 100 paise) everywhere, so GST maths
 * and rounding stay exact. Quantities are REAL (loose items sell by the kg).
 */
export const SCHEMA_SQL = /* sql */ `
CREATE TABLE IF NOT EXISTS products (
  sku            TEXT PRIMARY KEY,              -- short code, e.g. 'aashirvaad-atta-5kg'
  name           TEXT    NOT NULL,
  unit           TEXT    NOT NULL,              -- kg | g | litre | ml | packet | dozen | piece
  is_loose       INTEGER NOT NULL DEFAULT 0,    -- 1 = sold loose by weight
  cost_price     INTEGER NOT NULL,              -- paise, per unit
  mrp            INTEGER NOT NULL,              -- paise, per unit (GST-inclusive sell price)
  gst_rate       INTEGER NOT NULL DEFAULT 0,    -- percent: 0 | 5 | 12 | 18 | 28
  hsn            TEXT    NOT NULL DEFAULT '',
  qty            REAL    NOT NULL DEFAULT 0,     -- current stock
  reorder_level  REAL    NOT NULL DEFAULT 0,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bills (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  status        TEXT    NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft','final','void')),
  payment_mode  TEXT CHECK (payment_mode IN ('cash','upi','card')),
  payment_ref   TEXT,
  customer_name TEXT,                            -- set for khata (credit) bills
  on_credit     INTEGER NOT NULL DEFAULT 0,
  subtotal      INTEGER NOT NULL DEFAULT 0,      -- paise, taxable value (ex-GST)
  cgst          INTEGER NOT NULL DEFAULT 0,      -- paise
  sgst          INTEGER NOT NULL DEFAULT 0,      -- paise
  total         INTEGER NOT NULL DEFAULT 0,      -- paise, rounded payable
  chat_id       INTEGER,                         -- Telegram chat that owns this draft
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  finalized_at  TEXT
);

CREATE TABLE IF NOT EXISTS bill_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_id      INTEGER NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  sku          TEXT    NOT NULL,
  name         TEXT    NOT NULL,                 -- snapshot at add time
  unit         TEXT    NOT NULL,
  qty          REAL    NOT NULL,
  unit_price   INTEGER NOT NULL,                 -- paise, MRP snapshot (GST-inclusive)
  gst_rate     INTEGER NOT NULL,                 -- percent snapshot
  hsn          TEXT    NOT NULL DEFAULT '',
  line_taxable INTEGER NOT NULL DEFAULT 0,       -- filled on finalize
  line_cgst    INTEGER NOT NULL DEFAULT 0,
  line_sgst    INTEGER NOT NULL DEFAULT 0,
  line_total   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_bill_items_bill ON bill_items(bill_id);

CREATE TABLE IF NOT EXISTS khata_customers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  name_key   TEXT NOT NULL UNIQUE,               -- lower-cased for lookup
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS khata_ledger (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES khata_customers(id) ON DELETE CASCADE,
  delta       INTEGER NOT NULL,                  -- paise: +charge (owes more), -payment
  kind        TEXT    NOT NULL CHECK (kind IN ('charge','payment')),
  note        TEXT,
  bill_id     INTEGER REFERENCES bills(id),
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_khata_ledger_cust ON khata_ledger(customer_id);

CREATE TABLE IF NOT EXISTS preferences (
  key        TEXT PRIMARY KEY,                   -- e.g. default_payment, default_atta, shop_name
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS shop_config (
  id       INTEGER PRIMARY KEY CHECK (id = 1),   -- single row
  name     TEXT NOT NULL DEFAULT 'My Kirana Store',
  gstin    TEXT NOT NULL DEFAULT '',
  address  TEXT NOT NULL DEFAULT '',
  state    TEXT NOT NULL DEFAULT '',
  phone    TEXT NOT NULL DEFAULT ''
);

-- Idempotency guard: every processed Telegram update_id is recorded once.
CREATE TABLE IF NOT EXISTS processed_updates (
  update_id  INTEGER PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;
