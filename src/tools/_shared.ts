import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { StoreError } from "../util/errors.js";

/** Wrap a plain string as a tool result. */
export function text(body: string): CallToolResult {
  return { content: [{ type: "text", text: body }] };
}

/**
 * Run a tool body, converting business-rule refusals (StoreError) into a clear
 * message the agent relays to the owner, and unexpected errors into a safe
 * generic result. Keeps every tool handler small and consistent.
 */
export async function guard(
  fn: () => CallToolResult | Promise<CallToolResult>,
): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof StoreError) return text(`⚠️ ${e.message}`);
    console.error("tool error:", e);
    return { content: [{ type: "text", text: "⚠️ Something went wrong running that." }], isError: true };
  }
}
