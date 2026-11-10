/**
 * The little Markdown a chat answer uses, read into blocks the page can draw:
 * paragraphs, bullet and numbered lists, **bold** and *italic*. Anything else
 * stays as plain text. Nothing is turned into HTML, so an answer can never
 * put markup on the page.
 */

/** A run of text within a line. */
export interface Span {
  text: string;
  bold?: boolean;
  italic?: boolean;
}

export type ChatBlock =
  | { kind: "paragraph"; lines: Span[][] }
  | { kind: "list"; ordered: boolean; items: Span[][] };

const BULLET = /^[-*•]\s+(.*)$/;
const NUMBERED = /^\d+[.)]\s+(.*)$/;
const HEADING = /^#{1,6}\s+(.*)$/;
const INLINE = /\*\*(.+?)\*\*|\*(?!\s)(.+?)(?<!\s)\*/g;

/** One line's text, split into plain, bold and italic runs. An unclosed `**` stays as it is. */
export function parseSpans(line: string): Span[] {
  const spans: Span[] = [];
  let last = 0;
  for (const match of line.matchAll(INLINE)) {
    if (match.index > last) spans.push({ text: line.slice(last, match.index) });
    spans.push(match[1] !== undefined ? { text: match[1], bold: true } : { text: match[2], italic: true });
    last = match.index + match[0].length;
  }
  if (last < line.length) spans.push({ text: line.slice(last) });
  return spans;
}

/**
 * An answer still being written, made ready to draw: a trailing `*` is held
 * back and an open `**` is closed, so a bold word shows bold from its first
 * letter rather than as asterisks until its end arrives.
 */
export function settleWriting(text: string): string {
  const held = text.replace(/\*+$/, "");
  return (held.match(/\*\*/g)?.length ?? 0) % 2 === 1 ? `${held}**` : held;
}

/** An answer's text as paragraphs and lists. A blank line ends a paragraph or a list. */
export function parseChatText(text: string): ChatBlock[] {
  const normalized = text
    .replace(/\r\n?/g, "\n")
    // The model sometimes runs bullets on without line breaks ("like this:- one.- two").
    // A dash straight after the end of a sentence is never anything else.
    .replace(/([.!?:])-[ \t]+(?=\S)/g, "$1\n- ");

  const blocks: ChatBlock[] = [];
  let paragraph: Span[][] | null = null;
  let list: Extract<ChatBlock, { kind: "list" }> | null = null;

  for (const raw of normalized.split("\n")) {
    const line = raw.trim();
    if (line === "") {
      paragraph = null;
      list = null;
      continue;
    }

    const item = BULLET.exec(line) ?? NUMBERED.exec(line);
    if (item) {
      const ordered = !BULLET.test(line);
      if (!list || list.ordered !== ordered) {
        list = { kind: "list", ordered, items: [] };
        blocks.push(list);
      }
      list.items.push(parseSpans(item[1]));
      paragraph = null;
      continue;
    }

    // Headings are asked against, but if one comes it reads as a bold line.
    const heading = HEADING.exec(line);
    const spans = heading ? parseSpans(heading[1]).map((span) => ({ ...span, bold: true })) : parseSpans(line);
    if (!paragraph) {
      paragraph = [];
      blocks.push({ kind: "paragraph", lines: paragraph });
    }
    paragraph.push(spans);
    list = null;
  }

  return blocks;
}
