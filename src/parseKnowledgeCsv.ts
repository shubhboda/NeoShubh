/** RFC-style CSV parser with quoted fields and "" escapes. */
export function parseCsvRows(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const len = content.length;

  for (let i = 0; i < len; i++) {
    const c = content[i];
    if (inQuotes) {
      if (c === '"' && content[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") {
      field += c;
    }
  }

  row.push(field);
  if (row.some((cell) => cell.trim() !== "")) rows.push(row);

  return rows;
}

export interface KnowledgeRow {
  topic: string;
  content: string;
}

/**
 * Expects columns named `topic` and `text` (or `content`). Extra columns like `id` are ignored.
 */
export function parseKnowledgeCsv(raw: string): KnowledgeRow[] {
  const rows = parseCsvRows(raw.trim());
  if (rows.length < 2) return [];

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const topicIdx = header.findIndex((h) => h === "topic");
  let textIdx = header.findIndex((h) => h === "text");
  if (textIdx === -1) textIdx = header.findIndex((h) => h === "content");
  if (topicIdx === -1 || textIdx === -1) {
    throw new Error('CSV must include "topic" and "text" (or "content") header columns.');
  }

  const out: KnowledgeRow[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every((c) => !c.trim())) continue;
    const topic = (row[topicIdx] ?? "").trim();
    const content = (row[textIdx] ?? "").trim();
    if (!content) continue;
    const safeTopic =
      topic || `Untitled ${r}`;
    out.push({ topic: safeTopic, content });
  }
  return out;
}
