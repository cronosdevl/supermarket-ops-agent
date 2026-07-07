import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { formatINR, rupeesToPaise } from "../db/index.js";
import { balanceOf, charge, listOutstanding, payment } from "../db/khata.js";
import { guard, text } from "./_shared.js";

/** Human-readable balance line. Positive = owes shop; negative = advance. */
function balanceLine(name: string, balance: number): string {
  if (balance > 0) return `${name} owes ${formatINR(balance)}.`;
  if (balance < 0) return `${name} is ${formatINR(-balance)} in advance (you owe them).`;
  return `${name}'s khata is clear (₹0).`;
}

/** Khata (credit ledger) tools. Store-global — customers belong to the shop. */
export function khataTools() {
  const khataCharge = tool(
    "khata_charge",
    "Put an amount on a customer's credit (khata) — 'put ₹500 on Ramesh's credit'. " +
      "Opens a new khata if the customer doesn't have one yet. Increases what they owe.",
    {
      customer: z.string().describe("Customer name, e.g. 'Ramesh'"),
      amount: z.number().positive().describe("Amount in ₹ to add to their credit"),
      note: z.string().optional().describe("Optional note, e.g. what it was for"),
    },
    async (a) =>
      guard(() => {
        const { customer, balance } = charge(a.customer, rupeesToPaise(a.amount), { note: a.note });
        return text(`Added ${formatINR(rupeesToPaise(a.amount))} to ${customer.name}'s khata. ${balanceLine(customer.name, balance)}`);
      }),
  );

  const khataPayment = tool(
    "khata_payment",
    "Record a repayment against a customer's khata — 'Ramesh paid ₹300'. Reduces " +
      "what they owe. Refuses if the customer has no khata account (nothing to settle).",
    {
      customer: z.string().describe("Customer name"),
      amount: z.number().positive().describe("Amount in ₹ the customer paid back"),
      note: z.string().optional().describe("Optional note"),
    },
    async (a) =>
      guard(() => {
        const { customer, balance } = payment(a.customer, rupeesToPaise(a.amount), a.note);
        return text(`Recorded ${formatINR(rupeesToPaise(a.amount))} from ${customer.name}. ${balanceLine(customer.name, balance)}`);
      }),
  );

  const khataBalance = tool(
    "khata_balance",
    "Check a customer's khata balance — \"Ramesh's balance?\". Refuses if they have " +
      "no khata account.",
    {
      customer: z.string().describe("Customer name"),
    },
    async (a) =>
      guard(() => {
        const { customer, balance } = balanceOf(a.customer);
        return text(balanceLine(customer.name, balance));
      }),
  );

  const khataOutstanding = tool(
    "khata_outstanding",
    "List everyone with an open khata balance — 'who owes me?' / 'total udhaar?'. " +
      "Takes no input.",
    {},
    async () =>
      guard(() => {
        const rows = listOutstanding();
        if (rows.length === 0) return text("No open khata balances — everyone's clear.");
        const owes = rows.filter((r) => r.balance > 0);
        const advances = rows.filter((r) => r.balance < 0);
        const lines: string[] = [];
        if (owes.length) {
          const total = owes.reduce((s, r) => s + r.balance, 0);
          lines.push(`Owed to you (total ${formatINR(total)}):`);
          for (const r of owes) lines.push(`• ${r.customer.name} — ${formatINR(r.balance)}`);
        }
        if (advances.length) {
          if (lines.length) lines.push("");
          lines.push("In advance (you owe them):");
          for (const r of advances) lines.push(`• ${r.customer.name} — ${formatINR(-r.balance)}`);
        }
        return text(lines.join("\n"));
      }),
  );

  return [khataCharge, khataPayment, khataBalance, khataOutstanding];
}
