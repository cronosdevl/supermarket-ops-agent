import { Bot, InputFile } from "grammy";
import { config } from "../util/config.js";
import { db } from "../db/index.js";
import { respondToMessage, resetSession } from "../agent/respond.js";

/**
 * Idempotency guard (hard-part §5). Telegram redelivers updates on network
 * hiccups; we record every update_id exactly once. A duplicate insert changes
 * 0 rows -> we skip it, so a retried message can't double-bill or double-run.
 */
const insertUpdate = db.prepare("INSERT OR IGNORE INTO processed_updates (update_id) VALUES (?)");
function isFreshUpdate(updateId: number): boolean {
  return insertUpdate.run(updateId).changes === 1;
}

export function createBot(): Bot {
  const bot = new Bot(config.telegramBotToken);

  // Drop redelivered updates before any handler runs.
  bot.use(async (ctx, next) => {
    if (ctx.update.update_id !== undefined && !isFreshUpdate(ctx.update.update_id)) {
      return; // already processed
    }
    await next();
  });

  bot.command("start", (ctx) =>
    ctx.reply(
      "🛒 *Kirana Ops Agent* is online.\n\n" +
        "Just talk to me in plain language — receive stock, cut bills, check khata, " +
        "close the day, or ask for a PDF invoice or sales deck.\n\n" +
        "_Try:_ how much sugar is left?",
      { parse_mode: "Markdown" },
    ),
  );

  // Clear the conversation but keep durable store data (stock, khata, prefs).
  bot.command("new", (ctx) => {
    resetSession(ctx.chat.id);
    return ctx.reply("🧹 Started a fresh chat. Your store data and preferences are unchanged.");
  });

  // Every plain-text message goes to the agent.
  bot.on("message:text", async (ctx) => {
    const chatId = ctx.chat.id;
    const text = ctx.message.text;
    if (text.startsWith("/")) return; // unhandled slash command

    await ctx.replyWithChatAction("typing").catch(() => {});
    try {
      const { text: reply, files } = await respondToMessage(chatId, text);
      if (reply) await ctx.reply(reply);
      // Send any generated artifacts (PDF invoice, PPTX deck) as documents.
      for (const f of files) {
        await ctx.replyWithDocument(new InputFile(f.path, f.filename), f.caption ? { caption: f.caption } : {});
      }
    } catch (err) {
      console.error("respondToMessage failed:", err);
      await ctx.reply("⚠️ Something went wrong handling that. Please try again.");
    }
  });

  bot.catch((err) => console.error("grammY error:", err.error));

  return bot;
}
