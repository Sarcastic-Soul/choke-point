import { describe, expect, test } from "bun:test";
import { sameOrigin } from "../src/lib/guard";

const req = (headers: Record<string, string>) => new Request("http://localhost/api/x", { method: "POST", headers });

describe("sameOrigin", () => {
  test("allows a plain call with no browser headers", () => expect(sameOrigin(req({ host: "app.test" }))).toBe(true));
  test("allows same-origin browser calls", () => {
    expect(sameOrigin(req({ host: "app.test", "sec-fetch-site": "same-origin", origin: "https://app.test" }))).toBe(true);
  });
  test("refuses a call from another site", () => {
    expect(sameOrigin(req({ host: "app.test", "sec-fetch-site": "cross-site", origin: "https://evil.test" }))).toBe(false);
    expect(sameOrigin(req({ host: "app.test", origin: "https://evil.test" }))).toBe(false);
  });
});
