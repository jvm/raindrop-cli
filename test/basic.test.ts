import { describe, expect, it } from "vitest";
import { validateLimit } from "../src/core/validators.js";
import { redact } from "../src/core/errors.js";
import { mergeBody } from "../src/core/body.js";

describe("core helpers", () => {
  it("validates pagination limits", () => {
    expect(validateLimit(50)).toBe(50);
    expect(() => validateLimit(51)).toThrow();
  });

  it("redacts secrets", () => {
    expect(
      redact({ access_token: "secret", nested: { client_secret: "secret" } }),
    ).toEqual({
      access_token: "[redacted]",
      nested: { client_secret: "[redacted]" },
    });
  });

  it("merges explicit flags over request bodies", () => {
    expect(
      mergeBody(
        { title: "Old", link: "https://example.com" },
        { title: "New", tags: undefined },
      ),
    ).toEqual({ title: "New", link: "https://example.com" });
  });
});
