// Answer checking. The model's sentence is only shown if every name and number in it
// came back from a query. Otherwise we show a sentence built straight from the rows.
import type { Evidence } from "./tools";

interface Collected {
  strings: Set<string>;
  numbers: Set<number>;
}

function collect(value: unknown, into: Collected) {
  if (typeof value === "string") {
    into.strings.add(value);
    // edge ids look like "MEMBER_OF:a>b": the names inside them count too
    for (const part of value.split(/[:>]/)) if (part) into.strings.add(part);
  } else if (typeof value === "number") {
    into.numbers.add(value);
    into.numbers.add(Math.round(value));
    if (value > 0 && value <= 1) into.numbers.add(Math.round(value * 100));
  } else if (Array.isArray(value)) {
    for (const v of value) collect(v, into);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value)) collect(v, into);
  }
}

export function collectEvidence(evidence: Evidence[]): Collected {
  const c: Collected = { strings: new Set(), numbers: new Set() };
  for (const e of evidence) collect(e.output, c);
  return c;
}

export interface Verdict {
  ok: boolean;
  problems: string[];
}

const ONES = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const WORD_VALUE = new Map<string, number>([...ONES.map((w, i) => [w, i + 1] as const), ...TENS.map((w, i) => [w, (i + 2) * 10] as const)]);

// "thirty-three" is 33, "three" is 3. "one" is skipped: "one link" and "one new path" are ordinary English.
function spelledNumbers(text: string) {
  const out: { word: string; value: number }[] = [];
  const re = new RegExp(`\\b(${TENS.join("|")})(?:[- ](${ONES.slice(0, 9).join("|")}))?\\b|\\b(${ONES.slice(1).join("|")})\\b`, "gi");
  for (const m of text.matchAll(re)) {
    const value = m[3] ? WORD_VALUE.get(m[3].toLowerCase())! : WORD_VALUE.get(m[1].toLowerCase())! + (m[2] ? WORD_VALUE.get(m[2].toLowerCase())! : 0);
    out.push({ word: m[0], value });
  }
  return out;
}

// `allNames` are all names in the graph. Names with digits or punctuation are easy to spot in plain text.
export function validateAnswer(text: string, evidence: Evidence[], allNames: string[]): Verdict {
  const problems: string[] = [];
  const seen = collectEvidence(evidence);

  const quoted = [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  for (const q of quoted) {
    if (!seen.strings.has(q)) problems.push(`"${q}" did not come from a query`);
  }

  const bare = text.replace(/`[^`]*`/g, " ");
  for (const name of allNames) {
    if (/[0-9.:\-]/.test(name) && bare.includes(name) && !seen.strings.has(name)) {
      problems.push(`"${name}" is in the graph but was not in the results`);
    }
  }

  for (const m of bare.matchAll(/(?<![\w.])(\d+(?:\.\d+)?)%?(?!\w|\.\w)/g)) {
    const n = Number(m[1]);
    if (!seen.numbers.has(n)) problems.push(`the number ${m[1]} did not come from a query`);
  }

  for (const w of spelledNumbers(bare)) {
    if (!seen.numbers.has(w.value)) problems.push(`the number "${w.word}" did not come from a query`);
  }

  // Path counts live under different names: `total` (investigate), `before.paths` (fix_plan), `totalPaths` (company_exposure).
  const pathTotal = (e: Evidence) => {
    const o = e.output as { total?: number; totalPaths?: number; before?: { paths?: number } };
    return o?.total ?? o?.totalPaths ?? (typeof o?.before === "object" ? o.before?.paths : undefined);
  };
  const pathResults = evidence.filter((e) => pathTotal(e) !== undefined);
  if (pathResults.length && pathResults.every((e) => pathTotal(e) === 0)) {
    if (/\b(safe|no risk|nothing breaks|not at risk|cannot reach)\b/i.test(bare)) {
      problems.push("claims safety, but zero paths only means none are modeled");
    }
  }

  return { ok: problems.length === 0, problems };
}

type Out = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const last = (evidence: Evidence[], tool: string) => [...evidence].reverse().find((e) => e.tool === tool)?.output as Out | undefined;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function planSentences(plan: Out): string {
  const who = plan.scope === "identity" ? `\`${plan.identity}\`` : "the company";
  if (!plan.steps.length) {
    return `No path from ${who} to a crown jewel is modeled, so there is nothing to plan. That means none is recorded, not that none exists.`;
  }
  const head =
    plan.scope === "identity"
      ? `${who} has ${plan.before.paths} attack paths to the crown jewels. These ${plan.steps.length} fixes would bring that to ${plan.after.paths}.`
      : `${plan.before.users} users can reach the crown jewels, over ${plan.before.paths} paths. These ${plan.steps.length} fixes would bring that to ${plan.after.users} users and ${plan.after.paths} paths.`;
  const steps = (plan.steps as Out[]).map(
    (s, i) => `${["First", "Second", "Third", "Fourth", "Fifth"][i] ?? "Then"}, the ${s.type} link from \`${s.from}\` to \`${s.to}\` cuts ${plural(s.killed, "path", "paths")}, leaving ${s.pathsAfter}.`,
  );
  return `${head} ${steps.join(" ")} Each one is a draft: a person approves it in the interface.`;
}

function exposureSentences(x: Out): string {
  if (!x.totalPaths) {
    return `No user can reach a crown jewel in the modeled graph. That means none is recorded, not that none exists.`;
  }
  const top = x.edges?.[0];
  return (
    `${x.users} of ${x.usersTotal} users can reach a crown jewel, over ${x.totalPaths} paths.` +
    (top
      ? ` The busiest link is the ${top.type} link from \`${top.from}\` to \`${top.to}\`. It sits on ${top.paths} paths (${top.percent}%) and ${plural(top.users, "user is", "users are")} routed through it.`
      : "")
  );
}

// A sentence built from rows only. Used when the model's text fails the check, or no model is available.
export function summarize(evidence: Evidence[]): string {
  const unknown = evidence.find((e) => (e.output as Out)?.status === "unknown_entity");
  const inv = last(evidence, "investigate");
  const paths = inv?.status === "ok" ? inv : last(evidence, "attack_paths");
  const choke = inv?.status === "ok" ? inv : last(evidence, "choke_points");
  const whatIf =
    inv?.status === "ok" && inv.whatIf
      ? { status: "ok", before: inv.whatIf.before, after: inv.whatIf.after, edge: inv.edges.find((e: Out) => e.id === inv.whatIf.edgeId) }
      : last(evidence, "what_if_remove");
  const since = last(evidence, "new_paths_since_last_fix");
  const recalled = last(evidence, "recall_fixes");

  const anyOk = evidence.some((e) => (e.output as Out)?.status === "ok");
  if (unknown && !anyOk) {
    const o = unknown.output as Out;
    const hint = o.suggestions?.length ? ` Closest names: ${o.suggestions.map((s: string) => `\`${s}\``).join(", ")}.` : "";
    return `\`${o.name}\` is not in the graph, so I did not run any query.${hint}`;
  }

  const parts: string[] = [];
  const plan = last(evidence, "fix_plan");
  if (plan?.status === "ok") parts.push(planSentences(plan));
  const exposure = last(evidence, "company_exposure");
  if (exposure?.status === "ok") parts.push(exposureSentences(exposure));
  if (paths?.status === "ok") {
    if (paths.total === 0) {
      parts.push(
        `No path from \`${paths.identity}\` to a crown jewel is modeled in the graph. That means none is recorded, not that none exists.`,
      );
    } else {
      const shortest = paths.paths?.[0];
      parts.push(
        `\`${paths.identity}\` has ${paths.total} attack paths to the crown jewels.` +
          (shortest ? ` The shortest takes ${shortest.length} hops, ending at \`${shortest.nodes[shortest.nodes.length - 1]}\`.` : ""),
      );
    }
  }
  if (choke?.status === "ok" && choke.edges?.length) {
    const top = choke.edges[0];
    parts.push(
      `The best single fix is the ${top.type} link from \`${top.from}\` to \`${top.to}\`. It sits on ${top.paths} of ${choke.total} paths (${top.percent}%).`,
    );
  }
  if (whatIf?.status === "ok") {
    parts.push(`With \`${whatIf.edge.from}\` to \`${whatIf.edge.to}\` removed, paths drop from ${whatIf.before} to ${whatIf.after}.`);
  }
  if (since?.status === "no_fix_on_record") {
    parts.push(`No approved fix is on record for \`${since.identity}\`, so there is nothing to compare against.`);
  } else if (since?.status === "ok") {
    const f = since.lastFix;
    if (since.newPaths === 0) {
      parts.push(`The last fix (${f.title}) still holds. No new path has appeared since it was approved.`);
    } else {
      const route = (since.paths[0].nodes as string[]).map((n) => `\`${n}\``).join(", then ");
      parts.push(
        `The last fix (${f.title}) cut paths from ${f.pathsBefore} to ${f.pathsAfter}, but ${since.newPaths} new paths have opened since, through a link added after it. One route: ${route}.`,
      );
    }
  } else if (recalled?.status === "ok" && !recalled.fixes.length) {
    parts.push("No fix has been approved yet.");
  }
  return parts.length ? parts.join(" ") : "I did not get any results to report.";
}
