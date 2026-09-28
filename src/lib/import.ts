/**
 * Turning pasted text into cards.
 *
 * Pure, like the scheduler, so the fiddly cases (quoted fields, stray
 * separators, blank lines) can be tested without a database.
 */

export const SEPARATORS = {
  tab: "\t",
  comma: ",",
  semicolon: ";",
  pipe: "|",
} as const;

export type SeparatorName = keyof typeof SEPARATORS;

export interface ParsedCard {
  front: string;
  back: string;
}

export interface SkippedLine {
  /** 1-based line number in the pasted text, so the message can point at it. */
  line: number;
  text: string;
  reason: string;
}

export interface ParseResult {
  cards: ParsedCard[];
  skipped: SkippedLine[];
}

export interface ParseOptions {
  /**
   * Which character separates front from back. Defaults to `tab`, but a line
   * containing a tab is always split on the tab regardless: that is what you
   * get from a spreadsheet, and a tab is never part of the text itself.
   */
  separator?: SeparatorName;
}

export function parseCards(text: string, options: ParseOptions = {}): ParseResult {
  const separator = SEPARATORS[options.separator ?? "tab"];
  const cards: ParsedCard[] = [];
  const skipped: SkippedLine[] = [];
  const seen = new Set<string>();

  const lines = text.replace(/\r\n?/g, "\n").split("\n");

  lines.forEach((rawLine, index) => {
    const line = index + 1;
    const trimmed = rawLine.trim();

    if (trimmed === "") return; // blank lines are not worth reporting
    if (trimmed.startsWith("#")) return; // comment / header marker

    const char = rawLine.includes("\t") ? "\t" : separator;
    const fields = splitFields(rawLine, char);

    if (fields.length < 2) {
      skipped.push({
        line,
        text: trimmed,
        reason: `no "${describeSeparator(char)}" separator on this line`,
      });
      return;
    }

    const front = fields[0].trim();
    const back = fields[1].trim();

    if (front === "" || back === "") {
      skipped.push({ line, text: trimmed, reason: "front or back is empty" });
      return;
    }

    const key = front.toLowerCase();
    if (seen.has(key)) {
      skipped.push({ line, text: trimmed, reason: "duplicate front in this paste" });
      return;
    }

    seen.add(key);
    cards.push({ front, back });
  });

  return { cards, skipped };
}

/**
 * Split one line on `separator`, honouring double-quoted fields so that a
 * comma inside a quoted value does not break the row. Doubled quotes inside a
 * quoted field are an escaped quote, as in CSV.
 */
function splitFields(line: string, separator: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === separator && !inQuotes) {
      fields.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  fields.push(current);
  return fields;
}

function describeSeparator(char: string): string {
  switch (char) {
    case "\t":
      return "tab";
    case ",":
      return "comma";
    case ";":
      return "semicolon";
    case "|":
      return "pipe";
    default:
      return char;
  }
}
