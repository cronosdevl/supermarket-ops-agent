/**
 * Per-conversation context injected into tools that need to know *who* they're
 * acting for (e.g. which chat's bill draft). It comes from Telegram, never from
 * the model — so the model cannot spoof whose store/bill it operates on.
 */
export interface ToolContext {
  chatId: number;
}
