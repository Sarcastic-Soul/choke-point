// Usage: bun run scripts/check-env.ts
// Checks the database and the model key. Prints no secrets.
import { google } from "@ai-sdk/google";
import { generateText } from "ai";
import { getDb } from "../src/lib/graph/client";

const url = process.env.FALKORDB_URL ?? "(unset)";
const host = url.replace(/^[a-z]+:\/\//, "").replace(/^.*@/, "");
console.log(`FalkorDB target: ${host.split(":")[0].replace(/^(.{4}).*(.{8})$/, "$1…$2")}  user set: ${Boolean(process.env.FALKORDB_USERNAME)}  password set: ${Boolean(process.env.FALKORDB_PASSWORD)}`);

try {
  const db = await getDb();
  const t0 = Date.now();
  const graphs = await db.list();
  console.log(`DB: connected, ${Date.now() - t0} ms, graphs: ${JSON.stringify(graphs)}`);
  db.close();
} catch (e) {
  console.log(`DB: FAILED - ${(e as Error).message.slice(0, 200)}`);
}

const model = process.env.AGENT_MODEL ?? "gemini-2.5-flash-lite";
console.log(`Gemini key set: ${Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY)}  model: ${model}`);
try {
  const t0 = Date.now();
  const r = await generateText({ model: google(model), prompt: "Reply with the single word: ready", maxOutputTokens: 20 });
  console.log(`LLM: ok, ${Date.now() - t0} ms, reply: ${JSON.stringify(r.text.trim())}`);
} catch (e) {
  console.log(`LLM: FAILED - ${String((e as Error).message).replace(/key=[\w-]+/g, "key=***").slice(0, 300)}`);
}
process.exit(0);
