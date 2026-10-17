import { describe, expect, test } from "bun:test";
import { escapeMd, slugify, ticketFilename, ticketToMarkdown } from "../src/lib/export";

const draft = {
  title: "Remove alice.moreno from Legacy-VPN-Users",
  body: "alice.moreno inherits every right that Legacy-VPN-Users has. Remove the membership.",
  command: 'Remove-ADGroupMember -Identity "Legacy-VPN-Users" -Members "alice.moreno" -Confirm:$false',
};
const edge = { type: "MEMBER_OF", from: "alice.moreno", to: "Legacy-VPN-Users", id: "MEMBER_OF:a>b" };

describe("ticketToMarkdown", () => {
  const md = ticketToMarkdown({ identity: "alice.moreno", paths: { before: 33, after: 3 }, draft, edge, dataset: "Demo" });

  test("has the title, context, command, approval and footer", () => {
    expect(md.startsWith("# Remove alice.moreno from Legacy-VPN-Users\n")).toBe(true);
    expect(md).toContain("| Compromised identity | alice.moreno |");
    expect(md).toContain("| Attack paths before | 33 |");
    expect(md).toContain("| Attack paths after | 3 |");
    expect(md).toContain("| Link type | MEMBER\\_OF |");
    expect(md).toContain("| Dataset | Demo |");
    expect(md).toContain("```\nRemove-ADGroupMember");
    expect(md).toContain("- [ ] Reviewed by a person\n- [ ] Change window agreed");
    expect(md.trimEnd().endsWith("Draft written from a template by Choke Point from graph data. Review before running.")).toBe(true);
  });

  test("keeps the command raw inside the fence", () => {
    expect(md).toContain(draft.command);
  });

  test("works without edge, dataset or counts", () => {
    const bare = ticketToMarkdown({ identity: "", paths: { before: null, after: null }, draft });
    expect(bare).toContain("| Compromised identity | not recorded |");
    expect(bare).toContain("| Attack paths after | not measured |");
    expect(bare).not.toContain("Link type");
    expect(bare).not.toContain("Dataset");
  });

  test("escapes markup in names, headings and table cells", () => {
    const out = ticketToMarkdown({
      identity: "evil|name\n# x",
      paths: { before: 1, after: 0 },
      draft: { title: "Remove *a_b* from [c](http://x) <b>", body: "- list <script>", command: "x" },
    });
    expect(out).toContain("# Remove \\*a\\_b\\* from \\[c\\](http://x) \\<b\\>");
    expect(out).toContain("| Compromised identity | evil\\|name \\# x |");
    expect(out).toContain("\n\\- list \\<script\\>\n");
    // The table must keep exactly two cells per row.
    for (const line of out.split("\n").filter((l) => l.startsWith("| Compromised"))) {
      expect(line.replace(/\\\|/g, "").split("|").length).toBe(4);
    }
  });

  test("fence is longer than any backtick run in the command", () => {
    const out = ticketToMarkdown({
      identity: "a",
      paths: { before: 1, after: 0 },
      draft: { title: "t", body: "b", command: "echo ````x```` and ``y``" },
    });
    expect(out).toContain("`````\necho ````x```` and ``y``\n`````");
  });
});

describe("escapeMd", () => {
  test("flattens newlines and escapes a leading number marker", () => {
    expect(escapeMd("a\nb")).toBe("a b");
    expect(escapeMd("1. step")).toBe("1\\. step");
    expect(escapeMd("plain-name.ok")).toBe("plain-name.ok");
  });
});

describe("slugify and ticketFilename", () => {
  test("makes the expected name", () => {
    expect(ticketFilename(draft)).toBe("fix-remove-alice-moreno-from-legacy-vpn-users.md");
  });
  test("is ASCII only and strips accents", () => {
    expect(slugify("Café Ünïcode 日本語 ✓")).toBe("cafe-unicode");
    expect(ticketFilename({ title: "日本語" })).toBe("fix-ticket.md");
  });
  test("limits length and never ends with a dash", () => {
    const s = slugify("word ".repeat(40));
    expect(s.length).toBeLessThanOrEqual(60);
    expect(s.endsWith("-")).toBe(false);
  });
  test("no path characters survive", () => {
    expect(ticketFilename({ title: "../../etc/passwd" })).toBe("fix-etc-passwd.md");
    expect(ticketFilename({ title: "a\0b\\c:d" })).toMatch(/^[a-z0-9-]+\.md$/);
  });
});
