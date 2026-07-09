/**
 * Convert the model's GitHub-flavoured Markdown into the small subset Telegram's
 * "Markdown" parse mode actually renders — so replies show clean *bold* text and
 * readable lists instead of raw **, #, and | characters.
 *
 * Telegram legacy Markdown supports only *bold*, _italic_, `code`, ```pre``` and
 * [links](url). It has NO tables and NO headings. So we:
 *   - rewrite **bold** → *bold*   (Telegram uses single asterisks),
 *   - turn "## Heading" lines into *Heading*,
 *   - flatten | pipe | tables into one line per row — tables never render on
 *     Telegram and are unreadable on a narrow phone anyway.
 */

const isTableRow = (line: string): boolean => /^\s*\|.*\|\s*$/.test(line);

// A GitHub table's separator row, e.g. "|---|:--:|---|".
const isSeparatorRow = (line: string): boolean =>
  line.includes("-") && /^\s*\|?[\s:|-]*\|[\s:|-]*$/.test(line);

function splitCells(row: string): string[] {
  return row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

/** Turn a run of Markdown table rows into "• *first* — Label val · Label val". */
function tableToLines(rows: string[]): string[] {
  const body = rows.filter((r) => !isSeparatorRow(r));
  if (body.length === 0) return [];
  const header = splitCells(body[0]!);
  const dataRows = body.slice(1);
  if (dataRows.length === 0) return [header.join(" · ")]; // header-only

  return dataRows.map((row) => {
    const cells = splitCells(row);
    const first = cells[0] ?? "";
    const rest = cells
      .slice(1)
      .map((cell, i) => {
        const label = header[i + 1];
        return label ? `${label} ${cell}` : cell;
      })
      .filter((s) => s.trim().length > 0);
    return rest.length ? `• *${first}* — ${rest.join(" · ")}` : `• *${first}*`;
  });
}

export function toTelegramMarkdown(md: string): string {
  const out: string[] = [];
  let tableBuf: string[] = [];
  let inFence = false; // inside a ``` code block — pass through verbatim
  const flush = () => {
    if (tableBuf.length) {
      out.push(...tableToLines(tableBuf));
      tableBuf = [];
    }
  };

  for (const raw of md.split("\n")) {
    // A ``` line opens or closes a fenced code block. Telegram renders those in
    // monospace, so their contents (pipes, **, #) must be left exactly as-is.
    if (/^\s*```/.test(raw)) {
      flush();
      inFence = !inFence;
      out.push(raw);
      continue;
    }
    if (inFence) {
      out.push(raw);
      continue;
    }
    if (isTableRow(raw)) {
      tableBuf.push(raw.replace(/\*\*(.+?)\*\*/g, "*$1*")); // **bold** in cells too
      continue;
    }
    flush();
    // Inline transforms, outside code fences only.
    const line = raw
      .replace(/\*\*(.+?)\*\*/g, "*$1*") // **bold** → *bold*
      .replace(/^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/, "*$1*"); // "# Heading" → *Heading*
    out.push(line);
  }
  flush();

  return out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Last-resort plain text: drop the formatting markers entirely. */
export function stripFormatting(text: string): string {
  return text.replace(/[*`]/g, "");
}

/**
 * Split a long message on line boundaries so each part is under Telegram's
 * 4096-character limit (we leave headroom for entity parsing).
 */
export function chunkMessage(text: string, max = 3900): string[] {
  if (text.length <= max) return [text];
  const parts: string[] = [];
  let current = "";
  for (const line of text.split("\n")) {
    if (current.length + line.length + 1 > max) {
      if (current) parts.push(current);
      current = line;
    } else {
      current = current ? `${current}\n${line}` : line;
    }
  }
  if (current) parts.push(current);
  return parts;
}
