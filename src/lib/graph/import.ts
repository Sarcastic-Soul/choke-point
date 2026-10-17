// "Bring your own data": turns an edge list (CSV) into the same node and edge shape the generator makes.
// Pure code, no database and no browser APIs, so the page and the tests can both use it.
//
// Format, header row required (case-insensitive, extra columns ignored):  type,from,to,note
//   type  MEMBER_OF | ADMIN_ON | HAS_SESSION | CAN_READ
// Node kinds are worked out from how a name is used, so there is no kind column:
//   target of MEMBER_OF = Group, target of ADMIN_ON = Host, target of CAN_READ = Secret,
//   source of HAS_SESSION = Host, target of HAS_SESSION = User,
//   source of MEMBER_OF / ADMIN_ON / CAN_READ = User (a name that is also a MEMBER_OF target is a Group,
//   and a Host may be the source of CAN_READ, because a server can hold a key).
import type { Dataset, GEdge, GNode, NodeKind, RelType } from "../data/generate";
import { countWalks, type PathGraph } from "../view";

export const LIMITS = { bytes: 1_048_576, edges: 5000, nodes: 2000, name: 80, note: 200, crown: 50, errors: 10 };

const TYPES: RelType[] = ["MEMBER_OF", "ADMIN_ON", "HAS_SESSION", "CAN_READ"];
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

export interface ImportSummary {
  nodes: number;
  edges: number;
  users: number;
  groups: number;
  hosts: number;
  secrets: number;
}
export type ParseResult = { ok: true; data: Dataset; summary: ImportSummary } | { ok: false; errors: string[] };

interface Rec {
  row: number; // 1-based line the record starts on, so people can find it in a text editor
  fields: string[];
}

// Small CSV reader: quoted fields, "" escapes, commas and line breaks inside quotes, \r\n or \n. Blank lines are skipped.
function readRecords(text: string): { records: Rec[]; openQuoteRow?: number } {
  const records: Rec[] = [];
  let fields: string[] = [];
  let field = "";
  // True while the field holds only spaces so far. Tracked by hand because calling field.trim() on every quote
  // makes a long run of quotes take quadratic time (a 1 MB file of b"b"b"... took 40 seconds).
  let blank = true;
  let quoted = false;
  let wasQuoted = false;
  let line = 1;
  let startLine = 1;
  const endRecord = () => {
    fields.push(field);
    const empty = fields.length === 1 && !wasQuoted && blank;
    if (!empty) records.push({ row: startLine, fields });
    fields = [];
    field = "";
    blank = true;
    wasQuoted = false;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          blank = false;
          i++;
        } else quoted = false;
      } else {
        if (c === "\n") line++;
        field += c;
        if (blank && c.trim() !== "") blank = false;
      }
    } else if (c === '"' && blank) {
      quoted = true;
      wasQuoted = true;
      field = "";
    } else if (c === ",") {
      fields.push(field);
      field = "";
      blank = true;
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      endRecord();
      line++;
      startLine = line;
    } else {
      field += c;
      if (blank && c.trim() !== "") blank = false;
    }
  }
  if (quoted) return { records, openQuoteRow: startLine };
  if (field !== "" || fields.length || wasQuoted) endRecord();
  return { records };
}

const article = (kind: string) => `a ${kind}`;

export function parseEdgeCsv(input: string, crown: string[]): ParseResult {
  const errors: string[] = [];
  const err = (msg: string) => {
    if (errors.length < LIMITS.errors) errors.push(msg);
  };
  const done = (): ParseResult => ({ ok: false, errors });

  if (input.length > LIMITS.bytes || new TextEncoder().encode(input).length > LIMITS.bytes) {
    err("The file is over 1 MB. Split it or remove rows you do not need.");
    return done();
  }
  const text = input.replace(/^﻿/, "");
  const { records, openQuoteRow } = readRecords(text);
  if (openQuoteRow) {
    err(`Row ${openQuoteRow}: a quote is opened but never closed.`);
    return done();
  }
  if (!records.length) {
    err("The file is empty. The first row must be a header: type,from,to,note");
    return done();
  }

  const header = records[0].fields.map((h) => h.trim().toLowerCase());
  const col = { type: header.indexOf("type"), from: header.indexOf("from"), to: header.indexOf("to"), note: header.indexOf("note") };
  const missing = (["type", "from", "to"] as const).filter((k) => col[k] < 0);
  if (missing.length) {
    err(`Row ${records[0].row}: the header is missing ${missing.join(", ")}. The first row must be: type,from,to,note`);
    return done();
  }

  // Pass 1: check every row on its own and merge duplicate edges.
  interface Row { row: number; type: RelType; from: string; to: string; note: string }
  const rows = new Map<string, Row>();
  const checkName = (row: number, label: string, v: string) => {
    if (!v) err(`Row ${row}: "${label}" is empty.`);
    else if (v.length > LIMITS.name) err(`Row ${row}: a name is longer than ${LIMITS.name} characters (${v.slice(0, 20)}...).`);
    else if (CONTROL.test(v)) err(`Row ${row}: the name "${v.replace(CONTROL, "?")}" has a control character in it.`);
    else if (v.includes(">")) err(`Row ${row}: the name "${v}" has a ">" in it, which is not allowed.`);
    else return true;
    return false;
  };
  let tooManyEdges = false;
  for (const rec of records.slice(1)) {
    const f = rec.fields;
    const need = Math.max(col.type, col.from, col.to) + 1;
    if (f.length < need) {
      err(`Row ${rec.row}: expected at least ${need} columns but found ${f.length}.`);
      continue;
    }
    const type = f[col.type].trim().toUpperCase();
    const from = f[col.from].trim();
    const to = f[col.to].trim();
    const note = col.note >= 0 ? (f[col.note] ?? "").replace(/[\t\r\n]+/g, " ").trim() : "";
    if (!TYPES.includes(type as RelType)) {
      err(`Row ${rec.row}: type "${f[col.type].trim().slice(0, 30)}" is not one of ${TYPES.join(", ")}.`);
      continue;
    }
    const okFrom = checkName(rec.row, "from", from);
    const okTo = checkName(rec.row, "to", to);
    if (!okFrom || !okTo) continue;
    if (from === to) {
      err(`Row ${rec.row}: "${from}" points at itself.`);
      continue;
    }
    if (note.length > LIMITS.note) {
      err(`Row ${rec.row}: the note is longer than ${LIMITS.note} characters.`);
      continue;
    }
    if (CONTROL.test(note)) {
      err(`Row ${rec.row}: the note has a control character in it.`);
      continue;
    }
    const id = `${type}:${from}>${to}`;
    const have = rows.get(id);
    if (have) {
      if (!have.note && note) have.note = note;
      continue;
    }
    if (rows.size >= LIMITS.edges) {
      if (!tooManyEdges) err(`Row ${rec.row}: more than ${LIMITS.edges} different edges. Remove some rows.`);
      tooManyEdges = true;
      continue;
    }
    rows.set(id, { row: rec.row, type: type as RelType, from, to, note });
  }

  // Names that differ only by case would clash in lookups (the trace box ignores case).
  const lower = new Map<string, string>();
  const names = new Set<string>();
  for (const r of rows.values()) {
    for (const n of [r.from, r.to]) {
      if (names.has(n)) continue;
      names.add(n);
      const k = n.toLowerCase();
      if (lower.has(k)) err(`Row ${r.row}: "${n}" and "${lower.get(k)}" differ only by letter case. Use one spelling.`);
      else lower.set(k, n);
    }
  }
  if (names.size > LIMITS.nodes) err(`The file names ${names.size} different things. The limit is ${LIMITS.nodes}.`);
  if (!rows.size && !errors.length) err("The file has a header but no edges.");

  // Pass 2: work out the kind of each name.
  const kinds = new Map<string, { kind: NodeKind; row: number; why: string }>();
  const claim = (name: string, kind: NodeKind, row: number, why: string) => {
    const have = kinds.get(name);
    if (!have) kinds.set(name, { kind, row, why });
    else if (have.kind !== kind) {
      err(`Row ${row}: "${name}" is ${article(kind)} here (${why}) but ${article(have.kind)} on row ${have.row} (${have.why}).`);
    }
  };
  for (const r of rows.values()) {
    if (r.type === "MEMBER_OF") claim(r.to, "Group", r.row, "target of MEMBER_OF");
    if (r.type === "ADMIN_ON") claim(r.to, "Host", r.row, "target of ADMIN_ON");
    if (r.type === "CAN_READ") claim(r.to, "Secret", r.row, "target of CAN_READ");
    if (r.type === "HAS_SESSION") {
      claim(r.from, "Host", r.row, "source of HAS_SESSION");
      claim(r.to, "User", r.row, "target of HAS_SESSION");
    }
  }
  for (const r of rows.values()) {
    if (r.type === "HAS_SESSION") continue;
    const have = kinds.get(r.from);
    if (!have) kinds.set(r.from, { kind: "User", row: r.row, why: `source of ${r.type}` });
    else if (have.kind === "Secret") err(`Row ${r.row}: "${r.from}" is a Secret (row ${have.row}, ${have.why}), so it cannot be the source of ${r.type}.`);
    else if (have.kind === "Host" && r.type !== "CAN_READ") err(`Row ${r.row}: "${r.from}" is a Host (row ${have.row}, ${have.why}), so it cannot be the source of ${r.type}.`);
  }

  // Crown jewels are named by the visitor and must exist.
  const crownSet = new Set<string>();
  const wanted = crown.map((c) => c.trim()).filter(Boolean);
  if (!wanted.length) err("Name at least one crown jewel, the thing an attacker is trying to reach.");
  if (wanted.length > LIMITS.crown) err(`Name at most ${LIMITS.crown} crown jewels.`);
  for (const c of wanted.slice(0, LIMITS.crown)) {
    if (names.has(c)) crownSet.add(c);
    else {
      const near = lower.get(c.toLowerCase());
      err(`Crown jewel "${c.slice(0, 80)}" is not in the edge list.${near ? ` Did you mean "${near}"?` : ""}`);
    }
  }
  if (errors.length) return done();

  const nodes: GNode[] = [];
  const counts = { User: 0, Group: 0, Host: 0, Secret: 0 };
  for (const [name, k] of kinds) {
    nodes.push({ name, kind: k.kind, crown: crownSet.has(name) });
    counts[k.kind] += 1;
  }
  const edges: GEdge[] = [...rows.entries()].map(([id, r]) => ({ id, type: r.type, from: r.from, to: r.to, note: r.note || undefined }));
  return {
    ok: true,
    data: { nodes, edges },
    summary: { nodes: nodes.length, edges: edges.length, users: counts.User, groups: counts.Group, hosts: counts.Host, secrets: counts.Secret },
  };
}

// The user a visitor should trace first: the one with the most live attack paths to a crown jewel.
// Counting is capped per user and overall, so a big graph still answers fast. If nobody can reach a crown jewel,
// the first user comes back with noPaths set so the page can say so.
export function suggestStart(data: Dataset): { suggested: string; noPaths: boolean; paths: number } {
  const view: PathGraph = {
    from: "",
    total: 0,
    nodes: data.nodes.map((n) => ({ id: n.name, kind: n.kind, crown: Boolean(n.crown) })),
    edges: data.edges.map((e) => ({ id: e.id, type: e.type, source: e.from, target: e.to, note: "", paths: 0, addedAt: 0 })),
  };
  // Who can reach a crown jewel at all, and how far away they are (reverse search from the crown nodes).
  const into = new Map<string, string[]>();
  for (const e of data.edges) into.set(e.to, [...(into.get(e.to) ?? []), e.from]);
  const dist = new Map<string, number>();
  const queue = data.nodes.filter((n) => n.crown).map((n) => n.name);
  for (const q of queue) dist.set(q, 0);
  for (let i = 0; i < queue.length; i++) {
    for (const p of into.get(queue[i]) ?? []) {
      if (!dist.has(p)) {
        dist.set(p, dist.get(queue[i])! + 1);
        queue.push(p);
      }
    }
  }
  const users = data.nodes.filter((n) => n.kind === "User");
  const reach = users.filter((u) => !u.crown && dist.has(u.name)).sort((a, b) => dist.get(a.name)! - dist.get(b.name)! || a.name.localeCompare(b.name));
  if (!reach.length) return { suggested: (users.find((u) => !u.crown) ?? users[0] ?? data.nodes[0]).name, noPaths: true, paths: 0 };

  let best = { name: reach[0].name, paths: -1 };
  let budget = 1_500_000;
  for (const u of reach) {
    if (budget <= 0) break;
    const cap = Math.min(5000, budget);
    const r = countWalks({ ...view, from: u.name }, view.edges, cap);
    budget -= cap;
    if (r.total > best.paths) best = { name: u.name, paths: r.total };
  }
  return { suggested: best.name, noPaths: false, paths: best.paths };
}

// ---- sample: a second synthetic company, so a visitor can try the importer with one click ----

export const SAMPLE_NAME = "Contoso Retail";
export const SAMPLE_CROWN = ["DC-CONTOSO-01", "secret:pos-signing-key"];

const q = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

// Contoso Retail: store staff, nested groups with one loop (IT-Ops and Platform-Eng contain each other),
// workstations with cached admin sessions, and two crown jewels (a domain controller and a signing key).
export function sampleCsv(): string {
  const rows: Array<[RelType, string, string, string?]> = [];
  const add = (type: RelType, from: string, to: string, note?: string) => rows.push([type, from, to, note]);
  const pad = (n: number) => String(n).padStart(2, "0");

  const clerks = ["priya.nair", "tom.brandt", "sara.okafor", "jin.park", "lea.martin", "omar.haddad", "nina.silva", "raj.kulkarni"];
  for (const c of clerks) add("MEMBER_OF", c, "Store-Staff");
  for (const m of ["luis.vega", "mina.cho", "bo.larsen"]) add("MEMBER_OF", m, "Store-Managers");
  add("MEMBER_OF", "Store-Managers", "Store-Staff");
  add("MEMBER_OF", "ravi.menon", "Regional-Managers");
  add("MEMBER_OF", "Regional-Managers", "Store-Managers");

  for (const c of ["kofi.mensah", "ana.ruiz", "ted.wu"]) add("MEMBER_OF", c, "Contractors");
  add("MEMBER_OF", "Contractors", "Helpdesk", "Nested during the 2023 store refit, never removed");
  for (const h of ["helen.park", "ivo.sanz"]) add("MEMBER_OF", h, "Helpdesk");

  // Store PCs: Helpdesk administers them, and some cache a login.
  const cached: Record<number, string> = { 1: "priya.nair", 2: "tom.brandt", 3: "luis.vega", 4: "dan.ortiz", 5: "sara.okafor", 6: "mina.cho", 7: "dan.ortiz", 8: "jin.park", 9: "ravi.menon", 10: "bo.larsen" };
  for (let i = 1; i <= 10; i++) {
    const pc = `PC-STORE-${pad(i)}`;
    add("ADMIN_ON", "Helpdesk", pc);
    add("HAS_SESSION", pc, cached[i], i === 4 || i === 7 ? "IT admin signed in here once and the login stayed cached" : undefined);
  }

  // IT groups that contain each other. This is the loop.
  for (const u of ["dan.ortiz", "eva.lund"]) add("MEMBER_OF", u, u === "dan.ortiz" ? "IT-Ops" : "Platform-Eng");
  add("MEMBER_OF", "IT-Ops", "Platform-Eng");
  add("MEMBER_OF", "Platform-Eng", "IT-Ops", "Added back during a 2022 clean-up, loops with IT-Ops");
  add("MEMBER_OF", "Platform-Eng", "Server-Admins");
  add("ADMIN_ON", "IT-Ops", "JUMP-02");
  for (const h of ["JUMP-01", "JUMP-02", "APP-01", "APP-02", "APP-03", "BUILD-01"]) add("ADMIN_ON", "Server-Admins", h);
  add("HAS_SESSION", "JUMP-01", "adm-carol");
  add("HAS_SESSION", "JUMP-02", "adm-victor");
  add("HAS_SESSION", "JUMP-02", "adm-carol");
  add("HAS_SESSION", "BUILD-01", "adm-victor");
  add("HAS_SESSION", "APP-01", "svc-inventory");
  add("HAS_SESSION", "APP-02", "svc-inventory");
  add("HAS_SESSION", "JUMP-01", "dan.ortiz");

  // Domain admins and the first crown jewel
  add("MEMBER_OF", "adm-carol", "Domain Admins");
  add("MEMBER_OF", "adm-victor", "Domain Admins");
  add("ADMIN_ON", "Domain Admins", "DC-CONTOSO-01", "Domain controller");
  add("CAN_READ", "Domain Admins", "secret:pos-signing-key");

  // Tills and the second crown jewel
  for (let i = 1; i <= 3; i++) {
    add("ADMIN_ON", "Store-Managers", `TILL-${pad(i)}`, i === 1 ? "Managers can sign in to the tills" : undefined);
    add("HAS_SESSION", `TILL-${pad(i)}`, "svc-pos");
  }
  add("MEMBER_OF", "svc-pos", "POS-Operators");
  add("CAN_READ", "POS-Operators", "secret:pos-signing-key", "Signs every card payment");

  // Marketing and low-value secrets: noise that leads nowhere
  for (const m of ["zoe.fisher", "adam.cole", "mei.lin"]) add("MEMBER_OF", m, "Marketing");
  add("ADMIN_ON", "Marketing", "CMS-01");
  add("HAS_SESSION", "CMS-01", "svc-cms");
  add("CAN_READ", "Marketing", "secret:cms-login");
  add("CAN_READ", "Store-Staff", "secret:guest-wifi-key");
  add("CAN_READ", "Store-Managers", "secret:price-feed-token");
  add("CAN_READ", "svc-inventory", "secret:inventory-db-login");
  add("CAN_READ", "CMS-01", "secret:cms-db-login");

  return ["type,from,to,note", ...rows.map(([t, f, to, n]) => [t, q(f), q(to), q(n ?? "")].join(","))].join("\n") + "\n";
}
