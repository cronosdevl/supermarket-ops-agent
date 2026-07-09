import { Bot, InputFile, type Context } from "grammy";
import { config } from "../util/config.js";
import { db } from "../db/index.js";
import { respondToMessage, resetSession } from "../agent/respond.js";
import { identifyProduct, type ImageMediaType } from "../agent/vision.js";
import { rememberOwnerChat } from "../util/owner.js";

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

  // Drop redelivered updates before any handler runs; remember the owner's chat
  // id (for proactive scheduled messages like khata reminders / weekly deck).
  bot.use(async (ctx, next) => {
    if (ctx.update.update_id !== undefined && !isFreshUpdate(ctx.update.update_id)) {
      return; // already processed
    }
    if (ctx.chat?.id) rememberOwnerChat(ctx.chat.id);
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

  // Run a prompt through the agent and send the reply + any generated documents.
  async function handlePrompt(ctx: Context, prompt: string): Promise<void> {
    const chatId = ctx.chat!.id;
    await ctx.replyWithChatAction("typing").catch(() => {});
    try {
      const { text: reply, files } = await respondToMessage(chatId, prompt);
      if (reply) await ctx.reply(reply);
      for (const f of files) {
        await ctx.replyWithDocument(new InputFile(f.path, f.filename), f.caption ? { caption: f.caption } : {});
      }
    } catch (err) {
      console.error("handlePrompt failed:", err);
      await ctx.reply("⚠️ Something went wrong handling that. Please try again.");
    }
  }

  // Plain-text messages go straight to the agent.
  bot.on("message:text", async (ctx) => {
    if (ctx.message.text.startsWith("/")) return; // unhandled slash command
    await handlePrompt(ctx, ctx.message.text);
  });

  // Photos: identify the product with Claude vision, then let the agent act on it.
  bot.on("message:photo", async (ctx) => {
    await ctx.replyWithChatAction("typing").catch(() => {});
    try {
      const file = await ctx.getFile(); // largest size by default
      const url = `https://api.telegram.org/file/bot${config.telegramBotToken}/${file.file_path}`;
      const bytes = Buffer.from(await (await fetch(url)).arrayBuffer());
      const mediaType: ImageMediaType = file.file_path?.endsWith(".png") ? "image/png" : "image/jpeg";

      const label = await identifyProduct(bytes.toString("base64"), mediaType);
      const caption = ctx.message.caption?.trim();

      if (label.toLowerCase() === "unclear") {
        await ctx.reply("I couldn't make out the product in that photo. Could you type the item name?");
        return;
      }
      const prompt =
        `[The owner sent a photo of a product. Vision identifies it as: "${label}".` +
        (caption ? ` Their note with the photo: "${caption}".` : "") +
        `] Match it to the catalogue with get_stock and help accordingly — if the note asks to bill or ` +
        `receive it, do that using the matched catalogue product; otherwise report what it is and its stock.`;
      await handlePrompt(ctx, prompt);
    } catch (err) {
      console.error("photo handling failed:", err);
      await ctx.reply("⚠️ I couldn't read that image. Please try again or type the item.");
    }
  });

  bot.catch((err) => console.error("grammY error:", err.error));

  return bot;
}
