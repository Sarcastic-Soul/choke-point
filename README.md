# Choke Point

An agent that answers one question for a security team: **if this account is compromised, which single change cuts the most attack paths?**

It reads a company graph in FalkorDB, finds every route from the compromised identity to the crown jewels (the domain controller and three key secrets), ranks the links by how many routes pass through them, shows what happens if the top link is cut, and drafts a fix ticket. A person approves the fix. The approved fix is stored in the graph, so the next scan can check that it still holds.

On the demo data, `alice.moreno` (a marketing contractor) has **33 attack paths**. One group nested inside another by mistake, `Legacy-VPN-Users` inside `IT-Support`, sits on 30 of them. Cut that one link and **3 paths** are left.

Built for the WeMakeDevs x FalkorDB Graph Hacks hackathon. Track 1: Agents That Act on Connected Data. It also touches Track 2 (Agent Memory and Coordination) through the remediation memory.

## Why a graph

"Who can reach what" is a path question, not a table question. Group nesting, admin rights and cached logins chain together, and the dangerous routes are five or more hops long. A graph database follows those hops in one query. The count of paths through each link, which is what makes a choke point, falls out of the same traversal.

## Run it

You need [bun](https://bun.sh), Docker, and optionally a free Gemini API key.

```bash
docker compose up -d            # FalkorDB on :6379, FalkorDB Browser on :3000
cp .env.example .env.local      # add GOOGLE_GENERATIVE_AI_API_KEY if you have one
bun install
bun run seed                    # builds the graph (671 nodes, 1,160 edges). A non-local database needs --yes
bun run dev                     # http://localhost:3001
bun test                        # needs the database to be running
```

Without a Gemini key the agent still works in offline mode: it runs the same graph queries and writes the answer from the result rows.

Settings (`.env.local`, same names on Vercel):

| Name | Meaning |
| --- | --- |
| `FALKORDB_URL` | `falkor://localhost:6379` locally, `falkor://<host>:<port>` for FalkorDB Cloud (use `falkors://` if your plan has TLS, because the password is otherwise sent in clear text) |
| `FALKORDB_USERNAME`, `FALKORDB_PASSWORD` | empty locally |
| `GOOGLE_GENERATIVE_AI_API_KEY` | optional, from Google AI Studio |
| `AGENT_MODEL` | model id, for example `gemini-3.5-flash-lite` (default `gemini-2.5-flash-lite`) |
| `AGENT_DAILY_LIMIT` | model calls per day on a public deployment before the agent switches to offline mode (default 400) |

## Graph data model

Edges point the way an attacker moves.

```
(User)  -[:MEMBER_OF]->   (Group)     a user, or a group nested in a group
(Group) -[:ADMIN_ON]->    (Host)      the group has admin rights on a machine
(Host)  -[:HAS_SESSION]-> (User)      a user is logged in there, so their credentials are cached
(Group|Host) -[:CAN_READ]-> (Secret)  can read a key or password
```

- Every node has the label `:Entity` plus its kind (`User`, `Group`, `Host`, `Secret`). Properties: `name`, `crown` (true for crown jewels), `dept`, `note`.
- Every edge has `id`, `weight`, `removed`, `addedAt` and `note`. Approving a fix sets `removed = true`. The path queries skip removed edges. (`algo.betweenness` takes only labels and relationship types, so the company-wide load ranking still counts them.)
- Approved fixes are `(:Fix)` nodes, linked `ABOUT` to both ends of the cut edge and `FOUND_FROM` to the identity that was investigated.
- One graph per tenant, named `org:<tenant>`. The demo tenant is `northwind`.

The data is synthetic ("Northwind Freight"), made by a seeded generator in `src/lib/data/generate.ts`, so every run is the same. It has about 290 staff in 8 departments, contractors, IT and help desk groups, admin accounts, service accounts, jump hosts, dev servers, and a planted mistake: a 2021 VPN migration nested `Legacy-VPN-Users` into `IT-Support`.

## Queries and algorithms used

All Cypher is in `src/lib/graph/queries.ts` and `src/lib/graph/fixes.ts`, and every value is passed as a parameter.

- **All attack paths**: `MATCH p=(s:Entity {name: $from})-[:MEMBER_OF|ADMIN_ON|HAS_SESSION|CAN_READ*1..10]->(t:Entity {crown: true}) WHERE ALL(r IN relationships(p) WHERE r.removed = false)`
- **Choke points**: the same match, then `UNWIND relationships(p) AS r` and `count(*)` per edge id, ordered by count. Edges that start at the compromised identity are skipped, because "remove the user from their own group" is not a useful answer.
- **What if we cut it**: the same count again with one edge id left out. No graph copy is made.
- **Load-bearing nodes**: `CALL algo.betweenness(...)` over the whole company.
- **Memory**: `(:Fix)` nodes written on approval. The re-scan finds paths that use an edge with `addedAt` later than the last fix.
- The browser repeats the path counting on the returned subgraph (a dynamic program on the acyclic graph), so the preview of a cut is instant. It assumes the path graph has no cycles, which is true of the demo data. The totals matched the database for every identity with paths when I checked them by hand.

## How the agent is kept honest

- A fixed catalogue of ten tools (`src/lib/agent/tools.ts`). The model picks a tool and fills typed arguments. It never writes Cypher.
- Every tool checks the name against the graph itself. A name that is not in the graph returns `unknown_entity` with close matches, and the answer is fixed: that name is not in the graph, no query was run.
- An answer check (`src/lib/agent/answer.ts`): every name in backticks and every number in the reply must appear in the query rows. If the check fails, the reply is replaced by text built from the rows, and the interface says so.
- Zero paths is never reported as "safe". It is reported as "none is modeled".
- Fix tickets are written from templates, not by the model. The agent can draft a fix but cannot apply one. Only a person clicking **Approve** calls `/api/fix`.
- If the model is rate limited or down, the agent falls back to offline mode.

## Layout

```
src/lib/data/       synthetic company generator
src/lib/graph/      FalkorDB client, seed, queries, fixes and memory
src/lib/agent/      tools, answer check, agent loop
src/lib/view.ts     path counting and layout for the graph view
src/app/api/        agent (streaming), graph, whatif, fix, drift, reset
src/components/     the interface
tests/              bun tests (generator, queries, fixes, view)
```

## Limits

- The data is synthetic. Real directory data (for example BloodHound exports) would need an importer.
- Paths are counted up to 10 hops, which covers the longest planted route (9 hops). Real directory data has cycles; the browser preview of a cut would undercount there, so it needs a cycle-safe counter first.
- The demo graph is shared. On a public deployment, POST routes only accept same-origin calls, Reset is limited to one every 20 seconds, and the model has a daily budget (past it, answers come from the graph alone).
- The answer check matches names in backticks and every number against the query rows. It does not catch a wrong claim built from correct names and numbers.
- A "path" here is a route through permissions. It is not proof that an attacker could use it.
- The fix text uses PowerShell-style commands as examples, and nothing is run.

## AI use

This project was built with Claude Code (Anthropic). The agent inside the app uses Google Gemini through the Vercel AI SDK to choose tools and explain results.
