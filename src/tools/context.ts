/** A file a tool produced that should be sent to the owner as a Telegram document. */
export interface OutgoingFile {
  path: string;
  filename: string;
  caption?: string;
}

/**
 * Per-conversation context injected into tools. `chatId` comes from Telegram
 * (never the model) so billing/khata act on the right owner. `attachments` is a
 * per-turn outbox: document tools push generated files here, and the agent
 * response layer forwards them to Telegram after the turn completes.
 */
export interface ToolContext {
  chatId: number;
  attachments: OutgoingFile[];
}
