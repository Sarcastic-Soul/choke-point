import { describe, expect, test } from "bun:test";
import { buildLink, readLink } from "../src/lib/permalink";

describe("readLink", () => {
  test("reads from and edge", () => {
    expect(readLink("?from=alice.moreno&edge=MEMBER_OF%3Aa%3Eb")).toEqual({ from: "alice.moreno", edge: "MEMBER_OF:a>b" });
  });
  test("works without a leading question mark and with nothing", () => {
    expect(readLink("from=x")).toEqual({ from: "x" });
    expect(readLink("")).toEqual({});
    expect(readLink("?")).toEqual({});
  });
  test("trims and drops empty values", () => {
    expect(readLink("?from=%20%20&edge=")).toEqual({});
    expect(readLink("?from=%20bob%20")).toEqual({ from: "bob" });
  });
  test("strips control characters", () => {
    expect(readLink("?from=a%00b%0Ac%1Fd%7Fe")).toEqual({ from: "abcde" });
    expect(readLink("?from=%00%01")).toEqual({});
    expect(readLink("?from=a%E2%80%A8b")).toEqual({ from: "ab" });
  });
  test("caps length at 80 and 200", () => {
    const r = readLink(`?from=${"a".repeat(500)}&edge=${"b".repeat(500)}`);
    expect(r.from).toHaveLength(80);
    expect(r.edge).toHaveLength(200);
  });
  test("does not split an emoji when cutting", () => {
    const r = readLink(`?from=${encodeURIComponent("😀".repeat(100))}`);
    expect(Array.from(r.from ?? "")).toHaveLength(80);
    expect(r.from).toBe("😀".repeat(80));
  });
  test("handles unicode and encoded ampersands", () => {
    expect(readLink(`?from=${encodeURIComponent("José Ünal")}`)).toEqual({ from: "José Ünal" });
    expect(readLink("?from=a%26edge%3Dnope&edge=real")).toEqual({ from: "a&edge=nope", edge: "real" });
  });
  test("survives broken encoding and uses the first duplicate", () => {
    expect(() => readLink("?from=%E0%A4%A&edge=%")).not.toThrow();
    expect(readLink("?edge=%")).toEqual({ edge: "%" });
    expect(readLink("?from=one&from=two")).toEqual({ from: "one" });
  });
  test("ignores other params", () => {
    expect(readLink("?utm=1&from=x&__proto__=y")).toEqual({ from: "x" });
  });
});

describe("buildLink", () => {
  test("builds an encoded link and omits empty values", () => {
    expect(buildLink("https://choke.example", { from: "alice.moreno", edge: "MEMBER_OF:a>b" })).toBe(
      "https://choke.example/?from=alice.moreno&edge=MEMBER_OF%3Aa%3Eb",
    );
    expect(buildLink("http://localhost:3001", { from: "alice.moreno" })).toBe("http://localhost:3001/?from=alice.moreno");
    expect(buildLink("http://localhost:3001", { from: "  ", edge: "" })).toBe("http://localhost:3001/");
  });
  test("round-trips awkward values", () => {
    for (const from of ["a&b=c", "José Ünal", "x y+z", "100%", "😀"]) {
      const url = new URL(buildLink("https://x.test", { from, edge: from }));
      expect(readLink(url.search)).toEqual({ from, edge: from });
    }
  });
  test("drops control characters and caps length", () => {
    const url = new URL(buildLink("https://x.test", { from: "a\u0000b".repeat(60) }));
    expect(url.searchParams.get("from")).toHaveLength(80);
    expect(url.search).not.toContain("%00");
  });
  test("replaces any query already on the origin", () => {
    expect(buildLink("https://x.test/?old=1#h", { from: "a" })).toBe("https://x.test/?from=a");
  });
});
