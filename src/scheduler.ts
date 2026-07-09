import cron from "node-cron";
import type { Bot } from "grammy";
import { listOutstandingWithAge } from "./db/khata.js";
import { buildKhataReminderSummary } from "./domain/reminders.js";
import { getOwnerChatId } from "./util/owner.js";

/**
 * Proactive, scheduled jobs (cron). These need a live process, so they're
 * started from the bot entry point. Each job targets the owner's chat id
 * (captured on interaction, or set via OWNER_CHAT_ID). Schedules and timezone
 * are configurable via env; defaults suit an Indian kirana (IST).
 */

const TZ = process.env.TZ?.trim() || "Asia/Kolkata";
const KHATA_CRON = process.env.KHATA_REMINDER_CRON?.trim() || "0 10 * * *"; // 10:00 daily
const KHATA_MIN_DAYS = Number(process.env.KHATA_REMINDER_MIN_DAYS ?? 3);

/** Send the owner a khata reminder for debts at least KHATA_MIN_DAYS old. */
export async function sendKhataReminders(bot: Bot): Promise<void> {
  const chatId = getOwnerChatId();
  if (!chatId) return;
  const rows = listOutstandingWithAge().filter((r) => r.daysSince >= KHATA_MIN_DAYS);
  const summary = buildKhataReminderSummary(rows);
  if (!summary) return;
  await bot.api.sendMessage(chatId, summary).catch((e) => console.error("khata reminder send failed:", e));
}

export function startSchedulers(bot: Bot): void {
  if (cron.validate(KHATA_CRON)) {
    cron.schedule(KHATA_CRON, () => sendKhataReminders(bot), { name: "khata-reminders", timezone: TZ });
    console.log(`✓ scheduler: khata reminders @ "${KHATA_CRON}" (${TZ})`);
  } else {
    console.warn(`⚠ invalid KHATA_REMINDER_CRON: "${KHATA_CRON}" — reminders disabled`);
  }
}
