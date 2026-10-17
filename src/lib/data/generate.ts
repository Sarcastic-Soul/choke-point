// Deterministic generator for the fictional company "Northwind Freight".
// Same seed, same graph. All data is synthetic.
//
// Direction of every edge is the direction an attacker moves:
//   User  -MEMBER_OF->   Group   inherits the group's rights
//   Group -ADMIN_ON->    Host    can run code on the host
//   Host  -HAS_SESSION-> User    credentials are cached on the host, so an admin can steal them
//   Group -CAN_READ->    Secret  can read the secret
//
// The generator keeps the graph free of cycles so path counts stay exact.
// `tests/generate.test.ts` checks this.

export type NodeKind = "User" | "Group" | "Host" | "Secret";
export type RelType = "MEMBER_OF" | "ADMIN_ON" | "HAS_SESSION" | "CAN_READ";

export interface GNode {
  name: string;
  kind: NodeKind;
  crown?: boolean;
  dept?: string;
  note?: string;
}

export interface GEdge {
  id: string;
  type: RelType;
  from: string;
  to: string;
  note?: string;
}

export interface Dataset {
  nodes: GNode[];
  edges: GEdge[];
}

export const SEED = 20261017;

export const DEMO_VICTIM = "alice.moreno";

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = [
  "aarav", "bianca", "carlos", "dana", "elif", "farid", "grace", "hiro", "ines", "jamal",
  "kavya", "liam", "mei", "noor", "omar", "priya", "quinn", "rosa", "sven", "tara",
  "uma", "viktor", "wen", "xavier", "yara", "zane", "amara", "bruno", "chloe", "dmitri",
  "esha", "felix", "gita", "hana", "ivan", "jules", "kofi", "lena", "mateo", "nina",
];
const LAST = [
  "almeida", "bose", "castillo", "dubois", "eriksen", "fischer", "gupta", "hassan", "ito", "jensen",
  "khan", "lopez", "mehta", "novak", "okafor", "petrov", "quintero", "rao", "silva", "tanaka",
  "ueda", "varga", "wong", "xu", "yilmaz", "zhou", "abbas", "berg", "chen", "das",
  "evans", "farah", "garcia", "haas", "iyer", "joshi", "kaur", "laurent", "morris", "nair",
];

const DEPTS: Array<[string, number]> = [
  ["Engineering", 90],
  ["Sales", 50],
  ["Marketing", 30],
  ["Finance", 25],
  ["HR", 15],
  ["Support", 40],
  ["Legal", 10],
  ["Operations", 30],
];

const PROJECTS = [
  "Atlas", "Beacon", "Cobalt", "Delta", "Ember", "Fjord", "Garnet", "Harbor", "Indigo", "Juniper",
  "Kestrel", "Lumen", "Mosaic", "Nimbus", "Orchid", "Pioneer", "Quartz", "Ridge",
];

export function generate(seed = SEED): Dataset {
  const rnd = mulberry32(seed);
  const pick = <T>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];
  const shuffle = <T>(xs: T[]): T[] => {
    const a = xs.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  const nodes = new Map<string, GNode>();
  const edges = new Map<string, GEdge>();

  const node = (n: GNode) => {
    if (nodes.has(n.name)) throw new Error(`duplicate node ${n.name}`);
    nodes.set(n.name, n);
    return n;
  };
  const edge = (type: RelType, from: string, to: string, note?: string) => {
    if (!nodes.has(from)) throw new Error(`missing node ${from}`);
    if (!nodes.has(to)) throw new Error(`missing node ${to}`);
    const id = `${type}:${from}>${to}`;
    if (!edges.has(id)) edges.set(id, { id, type, from, to, note });
  };

  const usedNames = new Set<string>();
  const personName = () => {
    for (;;) {
      const n = `${pick(FIRST)}.${pick(LAST)}`;
      if (!usedNames.has(n)) {
        usedNames.add(n);
        return n;
      }
    }
  };

  // Crown jewels
  node({ name: "DC01", kind: "Host", crown: true, note: "Domain controller" });
  node({ name: "secret:krbtgt-hash", kind: "Secret", crown: true, note: "Kerberos ticket signing key" });
  node({ name: "secret:prod-db-creds", kind: "Secret", crown: true, note: "Production database login" });
  node({ name: "secret:backup-vault-key", kind: "Secret", crown: true, note: "Decrypts every backup" });

  // Privileged groups
  node({ name: "Domain Admins", kind: "Group", note: "Full control of the domain" });
  node({ name: "Tier0-Admins", kind: "Group" });
  node({ name: "Backup-Operators", kind: "Group" });
  node({ name: "Deploy-Admins", kind: "Group" });
  node({ name: "IT-Support", kind: "Group", note: "Admin on the jump hosts" });
  node({ name: "Legacy-VPN-Users", kind: "Group", note: "Created for the 2021 VPN migration, never cleaned up" });
  node({ name: "Helpdesk", kind: "Group", note: "Admin on staff workstations" });
  node({ name: "All-Staff", kind: "Group" });

  edge("ADMIN_ON", "Domain Admins", "DC01");
  edge("CAN_READ", "Domain Admins", "secret:krbtgt-hash");
  edge("CAN_READ", "Domain Admins", "secret:prod-db-creds");
  edge("MEMBER_OF", "Tier0-Admins", "Domain Admins");

  node({ name: "BACKUP-01", kind: "Host", note: "Backup server" });
  edge("ADMIN_ON", "Backup-Operators", "BACKUP-01");
  edge("CAN_READ", "BACKUP-01", "secret:backup-vault-key");

  // Departments, users and workstations
  const regularUsers: string[] = [];
  const wsOf = new Map<string, string>();
  let wsCount = 0;
  const addWorkstation = (user: string) => {
    wsCount += 1;
    const ws = `WS-${String(wsCount).padStart(3, "0")}`;
    node({ name: ws, kind: "Host", dept: nodes.get(user)?.dept });
    edge("HAS_SESSION", ws, user);
    wsOf.set(user, ws);
    return ws;
  };

  for (const [dept, size] of DEPTS) {
    node({ name: dept, kind: "Group", dept });
    edge("MEMBER_OF", dept, "All-Staff");
    for (let i = 0; i < size; i++) {
      const u = node({ name: personName(), kind: "User", dept });
      edge("MEMBER_OF", u.name, dept);
      addWorkstation(u.name);
      regularUsers.push(u.name);
    }
  }

  // The contractor who gets phished. Demo victim plus teammates.
  node({ name: "Marketing-Contractors", kind: "Group", dept: "Marketing" });
  edge("MEMBER_OF", "Marketing-Contractors", "All-Staff");
  const contractors = [DEMO_VICTIM, "ben.okoye", "carla.vidal", "dev.malhotra", "elena.sorokin", "finn.larsen"];
  for (const c of contractors) {
    usedNames.add(c);
    node({ name: c, kind: "User", dept: "Marketing" });
    edge("MEMBER_OF", c, "Marketing-Contractors");
    addWorkstation(c);
  }

  // IT staff. Helpdesk users never have a cached session on a machine Helpdesk administers.
  const itSupport = ["gus.pereira", "hana.sato", "ike.bauer", "jo.whitfield", "kim.ansah"];
  for (const u of itSupport) {
    usedNames.add(u);
    node({ name: u, kind: "User", dept: "IT" });
    edge("MEMBER_OF", u, "IT-Support");
  }
  const helpdesk = ["lou.fernandez", "max.delacroix", "ned.adeyemi", "oli.brandt"];
  for (const u of helpdesk) {
    usedNames.add(u);
    node({ name: u, kind: "User", dept: "IT" });
    edge("MEMBER_OF", u, "Helpdesk");
  }
  for (const [user, ws] of wsOf) {
    if (nodes.get(user)?.dept !== "IT") edge("ADMIN_ON", "Helpdesk", ws);
  }

  // Admin accounts and the jump hosts where their sessions are cached
  const admins = ["adm-ivan", "adm-june", "adm-kofi", "adm-lena", "adm-marco", "adm-nia"];
  for (const a of admins) node({ name: a, kind: "User", dept: "IT", note: "Privileged account" });
  node({ name: "svc-backup", kind: "User", dept: "IT", note: "Backup service account" });
  node({ name: "svc-deploy", kind: "User", dept: "IT", note: "Deploy service account" });
  edge("MEMBER_OF", "svc-backup", "Backup-Operators");
  edge("MEMBER_OF", "svc-deploy", "Deploy-Admins");

  for (const a of ["adm-ivan", "adm-june", "adm-kofi", "adm-nia"]) edge("MEMBER_OF", a, "Tier0-Admins");
  edge("MEMBER_OF", "adm-lena", "Backup-Operators");
  edge("MEMBER_OF", "adm-marco", "Backup-Operators");

  for (let i = 0; i < 6; i++) {
    const jump = `JUMP-${String(i + 1).padStart(2, "0")}`;
    node({ name: jump, kind: "Host", note: "Admin jump host" });
    edge("ADMIN_ON", "IT-Support", jump);
    edge("HAS_SESSION", jump, admins[i]);
    edge("HAS_SESSION", jump, admins[(i + 1) % admins.length]);
  }
  edge("HAS_SESSION", "JUMP-02", "svc-backup");
  edge("HAS_SESSION", "JUMP-03", "svc-backup");

  // Second, longer route that does not use the stale nesting
  node({ name: "WEB-CMS-01", kind: "Host", note: "Marketing CMS server" });
  node({ name: "BUILD-01", kind: "Host", note: "CI build server" });
  edge("ADMIN_ON", "Marketing-Contractors", "WEB-CMS-01", "Contractors were given admin to edit the CMS");
  edge("HAS_SESSION", "WEB-CMS-01", "svc-deploy");
  edge("ADMIN_ON", "Deploy-Admins", "BUILD-01");
  edge("HAS_SESSION", "BUILD-01", "adm-ivan");

  // THE misconfiguration: contractors nested into IT-Support through a forgotten group
  edge("MEMBER_OF", "Marketing-Contractors", "Legacy-VPN-Users", "Added during the 2021 VPN migration");
  edge("MEMBER_OF", "Legacy-VPN-Users", "IT-Support", "Nested by mistake, nobody owns it");

  // Project groups and dev servers: realistic noise. Dev servers cache sessions only for
  // users who belong to no project group, which keeps the graph acyclic.
  const projectGroups = PROJECTS.map((p) => `Proj-${p}`);
  for (const g of projectGroups) node({ name: g, kind: "Group" });
  const devServers = Array.from({ length: 8 }, (_, i) => `DEV-${String(i + 1).padStart(2, "0")}`);
  for (const d of devServers) node({ name: d, kind: "Host", note: "Dev server" });

  const inProject = new Set<string>();
  const eng = regularUsers.filter((u) => nodes.get(u)?.dept === "Engineering" || nodes.get(u)?.dept === "Operations");
  for (const g of projectGroups) {
    for (const u of shuffle(eng).slice(0, 5 + Math.floor(rnd() * 8))) {
      edge("MEMBER_OF", u, g);
      inProject.add(u);
    }
    for (const d of shuffle(devServers).slice(0, 1 + Math.floor(rnd() * 2))) edge("ADMIN_ON", g, d);
  }
  const devOnly = regularUsers.filter((u) => !inProject.has(u));
  for (const d of devServers) {
    for (const u of shuffle(devOnly).slice(0, 2 + Math.floor(rnd() * 3))) edge("HAS_SESSION", d, u);
  }

  // Low-value secrets and shared servers
  const lowSecrets = ["wiki-token", "jira-api-key", "slack-bot-token", "ci-cache-key", "staging-db-creds", "smtp-relay-login"];
  for (const s of lowSecrets) node({ name: `secret:${s}`, kind: "Secret" });
  for (const s of lowSecrets) edge("CAN_READ", pick(projectGroups), `secret:${s}`);
  edge("CAN_READ", "Marketing-Contractors", "secret:wiki-token");

  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}
