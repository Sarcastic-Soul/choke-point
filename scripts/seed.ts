import { getDb } from "../src/lib/graph/client";
import { seedGraph } from "../src/lib/graph/seed";

// Usage: bun run seed [tenant] [--yes]
// Seeding deletes the graph first, so a remote database needs --yes.
const args = process.argv.slice(2);
const yes = args.includes("--yes");
const tenant = args.find((a) => !a.startsWith("--"));
const url = process.env.FALKORDB_URL ?? "falkor://localhost:6379";
if (!/\/\/(localhost|127\.0\.0\.1)[:/]/.test(url) && !yes) {
  console.error("FALKORDB_URL is not local. Seeding deletes the graph first. Run again with --yes to go ahead.");
  process.exit(1);
}
const r = await seedGraph(tenant);
console.log(`Seeded ${r.graph}: ${r.nodes} nodes, ${r.edges} edges`);
(await getDb()).close();
