import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Centralized, validated configuration. Fails fast at startup if a required
 * secret is missing, so we never boot a half-configured bot.
 */

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(
      `\n✖ Missing required env var ${name}.\n` +
        `  Copy .env.example to .env and fill it in (see README).\n`,
    );
    process.exit(1);
  }
  return value;
}

export const config = {
  projectRoot,
  anthropicApiKey: required("ANTHROPIC_API_KEY"),
  telegramBotToken: required("TELEGRAM_BOT_TOKEN"),

  /** Model alias for the orchestration loop. Opus 4.8 by default; override with MODEL. */
  model: process.env.MODEL?.trim() || "claude-opus-4-8",

  /** Absolute path to the SQLite database file. */
  dbPath: process.env.DB_PATH?.trim() || path.join(projectRoot, "data", "store.db"),

  /** Where generated PDF invoices / PPTX decks are written. */
  artifactsDir: path.join(projectRoot, "artifacts"),
} as const;

// The Agent SDK reads the key from the environment; make sure it's set even if
// the process was started without it exported.
process.env.ANTHROPIC_API_KEY = config.anthropicApiKey;
