import { getPreference, setPreference } from "../db/preferences.js";

/**
 * The owner's Telegram chat id — needed for proactive (scheduled) messages like
 * khata reminders and the weekly deck. Captured on interaction and stored as an
 * internal ("_"-prefixed, hidden from the model) preference; overridable via the
 * OWNER_CHAT_ID env var.
 */
const KEY = "_owner_chat_id";

export function rememberOwnerChat(id: number): void {
  if (getPreference(KEY) !== String(id)) setPreference(KEY, String(id));
}

export function getOwnerChatId(): number | undefined {
  const env = process.env.OWNER_CHAT_ID?.trim();
  if (env && /^-?\d+$/.test(env)) return Number(env);
  const stored = getPreference(KEY);
  return stored && /^-?\d+$/.test(stored) ? Number(stored) : undefined;
}
