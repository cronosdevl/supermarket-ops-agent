import { getShopConfig } from "../db/shop.js";
import { getVisiblePreferences } from "../db/preferences.js";

/**
 * The durable owner context (hard-part §9). Built fresh from the DB on every
 * turn and appended to the system prompt, so shop identity and standing
 * preferences apply even in a brand-new `/new` chat — the memory lives in the
 * database, outside the conversation window.
 */
export function buildOwnerContext(): string {
  const shop = getShopConfig();
  const prefs = getVisiblePreferences();

  const lines = ["## What the store already knows (durable — applies across chats)"];
  lines.push(
    `Shop: ${shop.name}${shop.gstin ? `, GSTIN ${shop.gstin}` : ""} — this appears on invoices.`,
  );

  if (prefs.length > 0) {
    lines.push("Standing preferences — honour these by default unless the owner overrides them right now:");
    for (const p of prefs) lines.push(`- ${p.key}: ${p.value}`);
  } else {
    lines.push("No standing preferences set yet.");
  }

  return lines.join("\n");
}
