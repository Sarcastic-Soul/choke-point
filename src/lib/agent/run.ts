import { google } from "@ai-sdk/google";
import { stepCountIs, streamText } from "ai";
import { getGraph } from "../graph/client";
import { resolveEntity } from "../graph/queries";
import { summarize, validateAnswer } from "./answer";
import { buildTools, type Evidence } from "./tools";

export type AgentEvent =
  | { type: "tool"; name: string; input: unknown }
  | { type: "result"; name: string; output: unknown }
  | { type: "final"; text: string; mode: "model" | "offline"; checked: boolean; problems: string[] }
  | { type: "error"; text: string };

const SYSTEM = `You are Choke Point, a security analyst agent. You work on a graph of users, groups, hosts and secrets.
Edges point the way an attacker moves: User MEMBER_OF Group, Group ADMIN_ON Host, Host HAS_SESSION User (cached credentials), Group CAN_READ Secret.
Crown jewels are the domain controller and three key secrets.

Rules:
- Use the tools. Never answer from memory and never guess a name or a number.
- For a compromised identity: call investigate once. It returns the paths, the best fix, its effect and a draft ticket. Use the other tools only for follow-up questions.
- If a tool says unknown_entity, say that name is not in the graph and stop. Do not guess a nearby name.
- If a result has zero paths, say none is modeled. Never say the identity is safe.
- If the user asks for a plan, or which few things to fix ("what is the plan", "what 3 changes"), call fix_plan: with an identity for one person, without one for the whole company. Each step is advice, a person approves it. Say how many paths each step cuts and where the count ends. Never say anyone is secure or safe afterwards: zero paths means none is modeled.
- For questions about the whole company ("who can reach the crown jewels", "what is our biggest exposure"), call company_exposure.
- Counts from company_exposure overlap: one path can use several links, so never add them up and never present them as steps. For a sequence of fixes, use only the steps that fix_plan returned.
- If the user asks whether an earlier fix still holds, or what changed, call recall_fixes and new_paths_since_last_fix.
- Write plain English, 3 to 5 short sentences, no lists, no numbered steps.
- Put every user, group, host or secret name in backticks, exactly as the tool returned it.
- Write numbers as digits, for example 33, never as words. Use only numbers that appear in tool results. Say what a fix is, but never say it has been applied: a person approves it in the interface.`;

export function hasModel() {
  return Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY);
}

async function allNames(tenant?: string): Promise<string[]> {
  const g = await getGraph(tenant);
  const res = await g.roQuery(`MATCH (n:Entity) RETURN n.name AS name`);
  return (res.data ?? []).map((r) => (r as { name: string }).name);
}

// With no model key, the agent still works: it picks the identity from the message and runs the standard investigation.
async function offline(message: string, tenant: string | undefined, emit: (e: AgentEvent) => void, log: Evidence[]) {
  const names = await allNames(tenant);
  const lower = message.toLowerCase();
  const hit = names.filter((n) => /[.\-]/.test(n)).find((n) => lower.includes(n.toLowerCase()));
  const named = hit ?? message.match(/[a-z][\w.-]{2,}/gi)?.find((w) => w.includes(".") && !w.endsWith("."));
  const candidate = named ?? message.trim().slice(0, 60);
  const tools = buildTools(tenant, (e) => log.push(e));
  const run = async (name: keyof typeof tools, input: Record<string, unknown>) => {
    emit({ type: "tool", name, input });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const output = await (tools[name] as any).execute(input, { toolCallId: name, messages: [] });
    emit({ type: "result", name, output });
    return output as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  const r = await resolveEntity(candidate, tenant);
  const who = r.found ? r.entity.name : candidate;
  if (/still hold|hold up|changed|new path|since|last fix|drift|re-?scan/i.test(message)) {
    await run("recall_fixes", { identity: who });
    await run("new_paths_since_last_fix", { identity: who });
    return;
  }
  // Questions about the busiest nodes in the whole graph.
  if (/load[- ]?bearing|most load|carry the most|betweenness|most central|bottleneck/i.test(message)) {
    await run("load_bearing", { limit: 5 });
    return;
  }
  // Plan and company questions come before the single-identity default.
  const wantsPlan = /\bplan\b|what (?:\d+|two|three|four|five) (?:changes|things|fixes)|which (?:\d+|two|three|four|five) /i.test(message);
  const company = /company|everyone|everybody|organi[sz]ation|across|all users|whole|overall/i.test(message);
  const words: Record<string, number> = { two: 2, three: 3, four: 4, five: 5 };
  const asked = message.match(/\b([1-5])\b/)?.[1] ?? lower.match(/\b(two|three|four|five)\b/)?.[1];
  const steps = asked ? (words[asked] ?? Number(asked)) : 3;
  if (wantsPlan) {
    // A name that is not in the graph still goes to the tool, so the answer is the fixed "unknown" one.
    if (!company && (r.found || named)) await run("fix_plan", { identity: who, steps });
    else await run("fix_plan", { steps });
    return;
  }
  if (company && !r.found) {
    await run("company_exposure", { top: 5 });
    return;
  }
  await run("investigate", { identity: who });
}

export interface RunOptions {
  /** Skip the model and answer from the graph alone, for example past the daily model budget. */
  offlineOnly?: boolean;
  signal?: AbortSignal;
}

export async function runAgent(message: string, emit: (e: AgentEvent) => void, tenant?: string, opts: RunOptions = {}) {
  const log: Evidence[] = [];
  const names = await allNames(tenant);

  if (!hasModel() || opts.offlineOnly) {
    await offline(message, tenant, emit, log);
    const problems = opts.offlineOnly && hasModel() ? ["The daily model budget is used up, so this answer comes from the graph alone."] : [];
    emit({ type: "final", text: summarize(log), mode: "offline", checked: true, problems });
    return;
  }

  try {
    await withModel(message, emit, tenant, log, names, opts.signal);
  } catch (err) {
    // Rate limit or outage: answer from the graph alone rather than show an error.
    log.length = 0;
    await offline(message, tenant, emit, log);
    const reason = err instanceof Error ? err.message.slice(0, 120) : "model error";
    emit({ type: "final", text: summarize(log), mode: "offline", checked: true, problems: [`Model unavailable (${reason}). Answered from the graph alone.`] });
  }
}

async function withModel(message: string, emit: (e: AgentEvent) => void, tenant: string | undefined, log: Evidence[], names: string[], signal?: AbortSignal) {
  const tools = buildTools(tenant, (e) => log.push(e));
  const result = streamText({
    model: google(process.env.AGENT_MODEL ?? "gemini-2.5-flash-lite"),
    system: SYSTEM,
    prompt: message,
    tools,
    stopWhen: stepCountIs(8),
    temperature: 0,
    maxOutputTokens: 500,
    // A rate limit should fall back to offline mode quickly, not eat the function's whole time limit.
    maxRetries: 0,
    abortSignal: signal ? AbortSignal.any([signal, AbortSignal.timeout(40_000)]) : AbortSignal.timeout(40_000),
  });

  let text = "";
  for await (const part of result.fullStream) {
    if (part.type === "tool-call") emit({ type: "tool", name: part.toolName, input: part.input });
    else if (part.type === "tool-result") emit({ type: "result", name: part.toolName, output: part.output });
    else if (part.type === "text-delta") text += part.text;
    else if (part.type === "error") throw part.error;
  }

  // Unknown name: the answer is fixed, whatever the model wrote.
  const unknownOnly =
    log.length > 0 &&
    log.some((e) => (e.output as { status?: string }).status === "unknown_entity") &&
    !log.some((e) => (e.output as { status?: string }).status === "ok");
  if (unknownOnly) {
    emit({ type: "final", text: summarize(log), mode: "model", checked: true, problems: [] });
    return;
  }

  const verdict = validateAnswer(text, log, names);
  if (!text.trim() || !verdict.ok) {
    emit({ type: "final", text: summarize(log), mode: "model", checked: false, problems: verdict.problems });
  } else {
    emit({ type: "final", text: text.trim(), mode: "model", checked: true, problems: [] });
  }
}
