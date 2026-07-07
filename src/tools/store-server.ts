import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { inventoryTools } from "./inventory.js";
import { billingTools } from "./billing.js";
import { khataTools } from "./khata.js";
import type { ToolContext } from "./context.js";

/**
 * The store's in-process tool surface. Every capability the owner can invoke is
 * a thin, typed tool; the model orchestrates them. Business rules (grounding,
 * oversell guard, GST, idempotency, khata) live inside the tool/repo layer —
 * never in the prompt.
 *
 * Built PER CONVERSATION so chat-scoped tools (billing) close over the Telegram
 * chat id rather than trusting the model to supply it. Construction is cheap;
 * we rebuild it each turn.
 */
export function buildStoreServer(ctx: ToolContext) {
  const allTools = [...inventoryTools(), ...billingTools(ctx), ...khataTools()];

  const server = createSdkMcpServer({
    name: "store",
    version: "0.1.0",
    tools: allTools,
  });

  const toolNames = allTools.map((t) => `mcp__store__${t.name}`);
  return { server, toolNames };
}
