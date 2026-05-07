import { describe, expect, it } from "vitest";
import { redact } from "../src/core/errors.js";

describe("debug redaction", () => {
  it("redacts top-level secret keys", () => {
    expect(redact({ access_token: "secret123" })).toEqual({
      access_token: "[redacted]",
    });
    expect(redact({ refresh_token: "rt-123" })).toEqual({
      refresh_token: "[redacted]",
    });
    expect(redact({ client_secret: "cs-123" })).toEqual({
      client_secret: "[redacted]",
    });
    expect(redact({ Authorization: "Bearer tok" })).toEqual({
      Authorization: "[redacted]",
    });
    expect(redact({ password: "hunter2" })).toEqual({ password: "[redacted]" });
  });

  it("redacts nested secret keys", () => {
    const input = {
      user: { name: "Alice", token: "secret" },
      config: { api_key: "key123", port: 8080 },
    };
    expect(redact(input)).toEqual({
      user: { name: "Alice", token: "[redacted]" },
      config: { api_key: "key123", port: 8080 },
    });
  });

  it("redacts deeply nested secrets", () => {
    const input = {
      level1: {
        level2: {
          level3: { client_secret: "deep-secret", normal: "ok" },
        },
      },
    };
    expect(redact(input)).toEqual({
      level1: {
        level2: {
          level3: { client_secret: "[redacted]", normal: "ok" },
        },
      },
    });
  });

  it("redacts secrets in arrays", () => {
    const input = [
      { access_token: "tok1", name: "a" },
      { access_token: "tok2", name: "b" },
    ];
    expect(redact(input)).toEqual([
      { access_token: "[redacted]", name: "a" },
      { access_token: "[redacted]", name: "b" },
    ]);
  });

  it("preserves non-secret data", () => {
    const input = { title: "My Bookmark", _id: 123, tags: ["api", "docs"] };
    expect(redact(input)).toEqual(input);
  });

  it("handles case-insensitive key matching", () => {
    expect(redact({ TOKEN: "secret" })).toEqual({ TOKEN: "[redacted]" });
    expect(redact({ Secret: "s" })).toEqual({ Secret: "[redacted]" });
    expect(redact({ AUTHORIZATION: "Bearer x" })).toEqual({
      AUTHORIZATION: "[redacted]",
    });
  });

  it("handles primitives and null", () => {
    expect(redact("hello")).toBe("hello");
    expect(redact(42)).toBe(42);
    expect(redact(null)).toBe(null);
    expect(redact(undefined)).toBe(undefined);
    expect(redact(true)).toBe(true);
  });

  it("redacts agent-context output safely", () => {
    const agentContext = {
      schema_version: "1",
      cli: "raindrop",
      available_profiles: ["default", "work"],
      // Should never appear in real output:
      mock_creds: {
        access_token: "should-be-redacted",
        client_id: "safe-to-show",
      },
    };
    const result = redact(agentContext) as any;
    expect(result.mock_creds.access_token).toBe("[redacted]");
    expect(result.mock_creds.client_id).toBe("safe-to-show");
    expect(result.available_profiles).toEqual(["default", "work"]);
  });
});
