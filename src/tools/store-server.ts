import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { inventoryTools } from "./inventory.js";

/**
 * The store's in-process tool surface. Every capability the owner can invoke is
 * a thin, typed tool; the model orchestrates them. Business rules (grounding,
 * oversell guard, GST, idempotency, khata) live inside the tool/repo layer —
 * never in the prompt.
 *
 * Tools are grouped by skill/domain module and composed here. Add new modules'
 * tool arrays to `allTools` as later phases land (billing, khata, analytics,
 * documents, memory).
 */
const allTools = [...inventoryTools];

export const storeServer = createSdkMcpServer({
  name: "store",
  version: "0.1.0",
  tools: allTools,
});

/** Fully-qualified tool names to allow-list in query() options. */
export const STORE_TOOL_NAMES = allTools.map((t) => `mcp__store__${t.name}`);
