import Anthropic from "@anthropic-ai/sdk";
import { config } from "../util/config.js";

/**
 * Product identification from a photo, using Claude's native vision. Runs as a
 * one-shot call OUTSIDE the agent loop; the resulting label is fed back into the
 * normal text pipeline so the agent grounds it against the catalogue and acts.
 *
 * A small, fast model is plenty for reading packaging — override with VISION_MODEL.
 */
const VISION_MODEL = process.env.VISION_MODEL?.trim() || "claude-haiku-4-5";

// Key comes from our validated config (which also loads .env), so construction
// never races the dotenv load order.
const client = new Anthropic({ apiKey: config.anthropicApiKey });

const PROMPT = `You are identifying a grocery / FMCG product from a photo for an Indian kirana store.
Respond with ONE short line: brand, product, and size/pack if legible — e.g.
"Maggi 70g instant noodles" or "Aashirvaad Atta 5kg". If you cannot make out a
clear retail product, respond with exactly "unclear". No extra commentary.`;

export type ImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

/** Returns a concise product label, or "unclear" if it can't be identified. */
export async function identifyProduct(base64: string, mediaType: ImageMediaType): Promise<string> {
  const resp = await client.messages.create({
    model: VISION_MODEL,
    max_tokens: 100,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
          { type: "text", text: PROMPT },
        ],
      },
    ],
  });
  const label = resp.content.find((b) => b.type === "text");
  return (label && "text" in label ? label.text : "").trim() || "unclear";
}
