import { describe, it, expect } from "vitest";
import { toTelegramMarkdown, stripFormatting, chunkMessage } from "../src/telegram/format.js";

describe("toTelegramMarkdown", () => {
  it("rewrites **bold** to Telegram *bold*", () => {
    expect(toTelegramMarkdown("Colgate is **0** left")).toBe("Colgate is *0* left");
  });

  it("turns Markdown headings into bold lines", () => {
    expect(toTelegramMarkdown("## Current stock")).toBe("*Current stock*");
  });

  it("flattens a Markdown table into one readable line per row, with no pipes", () => {
    const md = [
      "Here's the current stock:",
      "",
      "| Product | Stock | MRP | GST |",
      "|---|---|---|---|",
      "| Maggi 70g | 152 packet | ₹14 | 18% |",
      "| Colgate 100g | **0** ⚠️ | ₹55 | 18% |",
    ].join("\n");

    const out = toTelegramMarkdown(md);
    expect(out).not.toContain("|"); // no raw table pipes survive
    expect(out).toContain("• *Maggi 70g* — Stock 152 packet · MRP ₹14 · GST 18%");
    expect(out).toContain("• *Colgate 100g* — Stock *0* ⚠️ · MRP ₹55 · GST 18%");
  });

  it("leaves plain prose untouched", () => {
    const text = "The current time is 9 July 2026.";
    expect(toTelegramMarkdown(text)).toBe(text);
  });

  it("passes fenced code blocks through verbatim (no table/bold rewriting inside)", () => {
    const md = ["Stock:", "```", "Item     | Qty", "Maggi    | 152", "```"].join("\n");
    const out = toTelegramMarkdown(md);
    // Pipes and alignment inside the fence survive untouched.
    expect(out).toContain("Item     | Qty");
    expect(out).toContain("Maggi    | 152");
    expect(out).toContain("```");
  });
});

describe("stripFormatting", () => {
  it("removes bold/code markers for the plain-text fallback", () => {
    expect(stripFormatting("*Maggi* costs `₹14`")).toBe("Maggi costs ₹14");
  });
});

describe("chunkMessage", () => {
  it("returns a single chunk when under the limit", () => {
    expect(chunkMessage("short message")).toEqual(["short message"]);
  });

  it("splits long text on line boundaries under the max", () => {
    const line = "x".repeat(100);
    const text = Array.from({ length: 100 }, () => line).join("\n"); // ~10k chars
    const chunks = chunkMessage(text, 500);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 500)).toBe(true);
    // No content is lost.
    expect(chunks.join("\n").replace(/\n/g, "")).toBe(text.replace(/\n/g, ""));
  });
});
