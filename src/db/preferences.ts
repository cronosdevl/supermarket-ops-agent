import { db } from "./index.js";

/**
 * Standing owner preferences — the store's durable memory (hard-part §9).
 * key→value, upserted. These live in the DB (outside the conversation), and are
 * injected into the system prompt each turn, so they persist across `/new` chats.
 *
 * Examples: default_payment=upi, default_atta=Aashirvaad Atta 5kg.
 */

export interface Preference {
  key: string;
  value: string;
  updated_at: string;
}

const upsertStmt = db.prepare(`
  INSERT INTO preferences (key, value, updated_at)
  VALUES (@key, @value, datetime('now'))
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
`);
const getStmt = db.prepare("SELECT value FROM preferences WHERE key = ?");
const allStmt = db.prepare("SELECT key, value, updated_at FROM preferences ORDER BY key");
const deleteStmt = db.prepare("DELETE FROM preferences WHERE key = ?");

const normalizeKey = (key: string) => key.trim().toLowerCase().replace(/\s+/g, "_");

export function setPreference(key: string, value: string): Preference {
  const k = normalizeKey(key);
  upsertStmt.run({ key: k, value: value.trim() });
  return { key: k, value: value.trim(), updated_at: "now" };
}

export function getPreference(key: string): string | undefined {
  const row = getStmt.get(normalizeKey(key)) as { value: string } | undefined;
  return row?.value;
}

export function getAllPreferences(): Preference[] {
  return allStmt.all() as Preference[];
}

export function deletePreference(key: string): boolean {
  return deleteStmt.run(normalizeKey(key)).changes > 0;
}
