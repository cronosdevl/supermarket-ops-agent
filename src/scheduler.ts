import fs from "node:fs";
import path from "node:path";
import cron from "node-cron";
import { Bot, InputFile } from "grammy";
import { config } from "./util/config.js";
import { formatINR } from "./db/index.js";
import { listOutstandingWithAge } from "./db/khata.js";
import { buildKhataReminderSummary } from "./domain/reminders.js";
import { buildDeckData } from "./domain/deck-data.js";
import { renderAnalysisDeck } from "./domain/analysis-deck.js";
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
const WEEKLY_DECK_CRON = process.env.WEEKLY_DECK_CRON?.trim() || "0 9 * * 1"; // Mon 09:00

/** Send the owner a khata reminder for debts at least KHATA_MIN_DAYS old. */
export async function sendKhataReminders(bot: Bot): Promise<void> {
  const chatId = getOwnerChatId();
  if (!chatId) return;
  const rows = listOutstandingWithAge().filter((r) => r.daysSince >= KHATA_MIN_DAYS);
  const summary = buildKhataReminderSummary(rows);
  if (!summary) return;
  await bot.api.sendMessage(chatId, summary).catch((e) => console.error("khata reminder send failed:", e));
}

/** Generate the weekly analysis deck and send it to the owner as a document. */
export async function sendWeeklyDeck(bot: Bot): Promise<void> {
  const chatId = getOwnerChatId();
  if (!chatId) return;
  const data = buildDeckData("week");
  if (data.summary.bills === 0) return; // quiet week — don't send an empty deck

  const filename = "Weekly-Sales-Analysis.pptx";
  const filePath = path.join(config.artifactsDir, filename);
  fs.mkdirSync(config.artifactsDir, { recursive: true });
  await renderAnalysisDeck(data, filePath);

  const s = data.summary;
  const caption = `📊 Weekly sales analysis — ${data.period.label}: ${s.bills} bill(s), ${formatINR(s.sales)} sales, ${formatINR(s.gst)} GST collected.`;
  await bot.api
    .sendDocument(chatId, new InputFile(filePath, filename), { caption })
    .catch((e) => console.error("weekly deck send failed:", e));
}

export function startSchedulers(bot: Bot): void {
  if (cron.validate(KHATA_CRON)) {
    cron.schedule(KHATA_CRON, () => sendKhataReminders(bot), { name: "khata-reminders", timezone: TZ });
    console.log(`✓ scheduler: khata reminders @ "${KHATA_CRON}" (${TZ})`);
  } else {
    console.warn(`⚠ invalid KHATA_REMINDER_CRON: "${KHATA_CRON}" — reminders disabled`);
  }

  if (cron.validate(WEEKLY_DECK_CRON)) {
    cron.schedule(WEEKLY_DECK_CRON, () => sendWeeklyDeck(bot), { name: "weekly-deck", timezone: TZ });
    console.log(`✓ scheduler: weekly deck @ "${WEEKLY_DECK_CRON}" (${TZ})`);
  } else {
    console.warn(`⚠ invalid WEEKLY_DECK_CRON: "${WEEKLY_DECK_CRON}" — weekly deck disabled`);
  }
}
