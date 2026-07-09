import { config } from "./util/config.js";
import { initDb } from "./db/index.js";
import { createBot } from "./telegram/bot.js";
import { startSchedulers } from "./scheduler.js";

async function main(): Promise<void> {
  initDb();
  const bot = createBot();

  // Fail fast with a clear message if the token is wrong.
  const me = await bot.api.getMe();
  console.log(`✓ Connected to Telegram as @${me.username} (model: ${config.model})`);

  // Proactive scheduled jobs (khata reminders, weekly deck).
  startSchedulers(bot);
  console.log("✓ Bot is running. Press Ctrl+C to stop.");

  // Graceful shutdown so WAL is checkpointed cleanly.
  const stop = () => {
    console.log("\n… shutting down");
    bot.stop();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  await bot.start({ drop_pending_updates: true });
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
