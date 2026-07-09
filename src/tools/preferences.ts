import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { deletePreference, getVisiblePreferences, setPreference } from "../db/preferences.js";
import { StoreError } from "../util/errors.js";
import { guard, text } from "./_shared.js";

/**
 * Standing-preference tools. These persist in the DB and are surfaced to you at
 * the start of every conversation, so honour them by default and use these tools
 * to remember new ones. Reuse an existing key when updating a preference.
 */
export function preferencesTools() {
  const setPref = tool(
    "set_preference",
    "Remember a standing preference the owner states — e.g. 'always assume UPI " +
      "unless I say cash' or 'default atta = Aashirvaad 5kg'. Persists across chats. " +
      "Pick a short snake_case key (e.g. default_payment, default_atta) and REUSE the " +
      "same key when the owner changes that preference. Check current preferences first " +
      "if unsure of the key.",
    {
      key: z.string().describe("Short stable identifier, e.g. 'default_payment'"),
      value: z.string().describe("The preference value, e.g. 'upi' or 'Aashirvaad Atta 5kg'"),
    },
    async (a) =>
      guard(() => {
        const p = setPreference(a.key, a.value);
        return text(`✓ Remembered: ${p.key} = ${p.value}. I'll apply this from now on, across chats.`);
      }),
  );

  const getPrefs = tool(
    "get_preferences",
    "List all standing preferences the store remembers. Takes no input.",
    {},
    async () =>
      guard(() => {
        const prefs = getVisiblePreferences();
        if (prefs.length === 0) return text("No standing preferences set yet.");
        return text(["Standing preferences:", ...prefs.map((p) => `• ${p.key} = ${p.value}`)].join("\n"));
      }),
  );

  const forgetPref = tool(
    "forget_preference",
    "Forget a standing preference by its key ('stop assuming UPI'). Refuses if the key isn't set.",
    {
      key: z.string().describe("The preference key to remove, e.g. 'default_payment'"),
    },
    async (a) =>
      guard(() => {
        if (!deletePreference(a.key)) throw new StoreError(`No preference named "${a.key}".`);
        return text(`✓ Forgot preference "${a.key}".`);
      }),
  );

  return [setPref, getPrefs, forgetPref];
}
