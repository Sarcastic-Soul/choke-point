// Pure text for the plan export. No database code here, so the browser can import it.
import type { FixPlan } from "./plan";

// A code fence longer than any run of backticks inside the text, so a command cannot close it early.
function fence(text: string) {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  return "`".repeat(longest + 1);
}

const n = (x: number, one: string, many: string) => `${x} ${x === 1 ? one : many}`;

export function planToMarkdown(plan: FixPlan): string {
  const who = plan.scope === "identity" ? `\`${plan.identity}\`` : "the whole company";
  const lines: string[] = [`# Fix plan for ${who}`, ""];
  if (plan.scope === "identity") {
    lines.push(`Attack paths to the crown jewels: **${plan.before.paths}** now, **${plan.after.paths}** after these ${plan.steps.length} fixes.`);
  } else {
    lines.push(
      `Users who can reach the crown jewels: **${plan.before.users}** now, **${plan.after.users}** after these ${plan.steps.length} fixes.`,
      `Attack paths: **${plan.before.paths}** now, **${plan.after.paths}** after.`,
    );
  }
  lines.push("", "This plan is advice. It changes nothing until a person approves each fix.", "");
  if (!plan.steps.length) {
    lines.push("No live attack path is modeled, so there is nothing to fix. That means none is recorded, not that none exists.", "");
    return lines.join("\n");
  }
  plan.steps.forEach((s, i) => {
    const f = fence(s.ticket.command);
    lines.push(
      `## ${i + 1}. ${s.ticket.title}`,
      "",
      `- Link: \`${s.type}\` from \`${s.from}\` to \`${s.to}\``,
      `- Cuts ${n(s.killed, "path", "paths")}, leaving ${s.pathsAfter}${plan.scope === "company" ? ` (${n(s.usersAfter, "user", "users")} can still reach the crown jewels)` : ""}`,
      "",
      s.ticket.body,
      "",
      f,
      s.ticket.command,
      f,
      "",
    );
  });
  return lines.join("\n");
}
