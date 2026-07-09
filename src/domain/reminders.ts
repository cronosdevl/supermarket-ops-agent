import { formatINR } from "../db/index.js";
import type { AgedDebtor } from "../db/khata.js";

/**
 * Build the owner-facing khata reminder summary (used by the scheduled proactive
 * nudge). Returns null when there's nothing to remind about.
 */
export function buildKhataReminderSummary(rows: AgedDebtor[]): string | null {
  if (rows.length === 0) return null;
  const total = rows.reduce((s, r) => s + r.balance, 0);
  const lines = [
    `🔔 Khata reminder — ${formatINR(total)} outstanding across ${rows.length} customer(s):`,
  ];
  for (const r of rows) {
    const age = r.daysSince === 0 ? "today" : `${r.daysSince} day${r.daysSince === 1 ? "" : "s"}`;
    lines.push(`• ${r.customer.name} — ${formatINR(r.balance)} (last activity ${age} ago)`);
  }
  lines.push("Ask me to draft a reminder message for any of them.");
  return lines.join("\n");
}
