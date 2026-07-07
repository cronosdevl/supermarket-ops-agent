import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { config } from "../util/config.js";
import { SCHEMA_SQL } from "./schema.js";

/**
 * Single shared SQLite connection.
 *
 * - WAL mode + a busy timeout let a sale and a stock-in run concurrently
 *   without "database is locked" errors.
 * - foreign_keys ON enforces referential integrity (khata, bill_items).
 * - Business-rule enforcement (oversell guard, idempotency) uses
 *   `db.transaction(...)`, which wraps in BEGIN/COMMIT and rolls back on throw.
 */

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new Database(config.dbPath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");

/** Create tables if missing. Idempotent — acts as a lightweight migration. */
export function initDb(): void {
  db.exec(SCHEMA_SQL);
  // Ensure the single shop_config row exists.
  db.prepare("INSERT OR IGNORE INTO shop_config (id) VALUES (1)").run();
}

// Run schema creation eagerly at module load so that any module which prepares
// statements against these tables (e.g. products.ts) always finds them — even on
// a brand-new database file where nothing has called initDb() yet.
initDb();

/** ₹ helpers: the DB speaks paise, humans speak rupees. */
export const rupeesToPaise = (rupees: number): number => Math.round(rupees * 100);
export const paiseToRupees = (paise: number): number => paise / 100;
export const formatINR = (paise: number): string =>
  `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
