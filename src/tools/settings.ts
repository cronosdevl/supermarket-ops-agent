import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { getShopConfig, updateShopConfig } from "../db/shop.js";
import { guard, text } from "./_shared.js";

/** Shop identity used on invoices. Persists across sessions (durable in DB). */
export function settingsTools() {
  const setShopDetails = tool(
    "set_shop_details",
    "Set the shop's identity that appears on invoices — name, GSTIN, address, " +
      "state, phone. Only the fields you pass are changed. These persist across chats.",
    {
      name: z.string().optional().describe("Shop name shown on invoices"),
      gstin: z.string().optional().describe("Shop GSTIN"),
      address: z.string().optional().describe("Shop address"),
      state: z.string().optional().describe("State (for GST place of supply)"),
      phone: z.string().optional().describe("Contact phone"),
    },
    async (a) =>
      guard(() => {
        const cfg = updateShopConfig(a);
        return text(
          `✓ Shop details updated.\n` +
            `Name: ${cfg.name}\nGSTIN: ${cfg.gstin || "—"}\nAddress: ${cfg.address || "—"}\n` +
            `State: ${cfg.state || "—"}\nPhone: ${cfg.phone || "—"}`,
        );
      }),
  );

  const getShopDetails = tool(
    "get_shop_details",
    "Show the shop's current invoice details (name, GSTIN, address, state, phone). Takes no input.",
    {},
    async () =>
      guard(() => {
        const c = getShopConfig();
        return text(
          `Name: ${c.name}\nGSTIN: ${c.gstin || "—"}\nAddress: ${c.address || "—"}\n` +
            `State: ${c.state || "—"}\nPhone: ${c.phone || "—"}`,
        );
      }),
  );

  return [setShopDetails, getShopDetails];
}
