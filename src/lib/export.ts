// Turns a fix draft into a Markdown ticket. Pure text in, text out: no browser APIs, no model.
import type { FixDraft } from "./graph/fixes";

export interface TicketInput {
  identity: string;
  paths: { before: number | null; after: number | null };
  draft: Pick<FixDraft, "title" | "body" | "command">;
  edge?: { type: string; from: string; to: string; id?: string; note?: string };
  dataset?: string;
}

// Names come from the graph, so they can hold anything. Escape what Markdown would read as markup.
export function escapeMd(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\\`*_{}[\]<>|#~!&]/g, "\\$&")
    .replace(/^(\d+)([.)])/, "$1\\$2")
    .replace(/^([-+=>])/, "\\$1");
}

// The fence has to be longer than any run of backticks inside, or the command would break out of it.
function fence(code: string): string {
  const longest = Math.max(0, ...(code.match(/`+/g) ?? []).map((run) => run.length));
  return "`".repeat(Math.max(3, longest + 1));
}

function count(n: number | null): string {
  return typeof n === "number" && Number.isFinite(n) ? String(n) : "not measured";
}

export function ticketToMarkdown({ identity, paths, draft, edge, dataset }: TicketInput): string {
  const rows: Array<[string, string]> = [["Compromised identity", escapeMd(identity) || "not recorded"]];
  if (dataset) rows.push(["Dataset", escapeMd(dataset)]);
  rows.push(["Attack paths before", count(paths.before)], ["Attack paths after", count(paths.after)]);
  if (edge) {
    rows.push(["Link type", escapeMd(edge.type)], ["Link from", escapeMd(edge.from)], ["Link to", escapeMd(edge.to)]);
    if (edge.id) rows.push(["Link id", escapeMd(edge.id)]);
  }
  const fenceMark = fence(draft.command);
  return [
    `# ${escapeMd(draft.title)}`,
    "",
    "| Item | Value |",
    "| --- | --- |",
    ...rows.map(([k, v]) => `| ${k} | ${v} |`),
    "",
    "## What to do",
    "",
    escapeMd(draft.body),
    "",
    "## Command",
    "",
    fenceMark,
    draft.command,
    fenceMark,
    "",
    "## Approval",
    "",
    "- [ ] Reviewed by a person",
    "- [ ] Change window agreed",
    "",
    "---",
    "",
    "Draft written from a template by Choke Point from graph data. Review before running.",
    "",
  ].join("\n");
}

// ASCII only, so the name is safe on every file system and in a download header.
export function slugify(title: string, max = 60): string {
  return title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, max)
    .replace(/-+$/, "");
}

export function ticketFilename(draft: Pick<FixDraft, "title">): string {
  return `fix-${slugify(draft.title) || "ticket"}.md`;
}
