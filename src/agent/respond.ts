import { query } from "@anthropic-ai/claude-agent-sdk";
import { config } from "../util/config.js";
import { buildStoreServer } from "../tools/store-server.js";
import { SYSTEM_PROMPT } from "./system-prompt.js";

/**
 * The agent brain. One `query()` per user turn, resumed by session id so the
 * conversation (multi-turn bills, follow-ups) carries across messages. Streaming
 * input mode doesn't fit an event-driven bot, so we resume instead.
 *
 * Tooling: only the in-process store MCP server is exposed, and
 * `permissionMode: 'dontAsk'` denies anything not pre-approved — the model can
 * never reach host Bash/Read/Write. Business rules live inside the tools.
 */

// chatId -> Claude session id. In-memory is fine for a single-process bot;
// durable store state (stock, khata, prefs) lives in SQLite, not here.
const sessions = new Map<number, string>();

/** Clear the conversation for a chat (used by /new). Durable store data is untouched. */
export function resetSession(chatId: number): void {
  sessions.delete(chatId);
}

export async function respondToMessage(chatId: number, text: string): Promise<string> {
  const resume = sessions.get(chatId);
  let reply = "";

  // Build the tool surface bound to this chat (billing acts on this chat's draft).
  const { server, toolNames } = buildStoreServer({ chatId });

  for await (const message of query({
    prompt: text,
    options: {
      model: config.model,
      systemPrompt: SYSTEM_PROMPT,
      mcpServers: { store: server },
      allowedTools: toolNames,
      permissionMode: "dontAsk",
      settingSources: [], // don't load host ~/.claude or project settings/skills
      cwd: config.projectRoot,
      resume,
      maxTurns: 20,
    },
  })) {
    if (message.type === "result") {
      // Persist the session id so the next turn resumes this conversation.
      sessions.set(chatId, message.session_id);
      reply =
        message.subtype === "success"
          ? message.result
          : `⚠️ I couldn't finish that (${message.subtype}). Please try rephrasing.`;
    }
  }

  return reply || "…";
}
