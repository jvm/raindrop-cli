import { describe, expect, it } from "vitest";
import { validateConfigKey } from "../src/core/validators.js";
import { CLIError } from "../src/core/errors.js";

describe("config key validation", () => {
  it("accepts valid config keys", () => {
    const validKeys = [
      "output",
      "default_collection",
      "default_limit",
      "active_profile",
      "base_url",
      "auth_url",
      "token_url",
      "max_retries",
    ];
    for (const key of validKeys) {
      expect(() => validateConfigKey(key)).not.toThrow();
    }
  });

  it("rejects invalid config keys with valid_values", () => {
    try {
      validateConfigKey("invalid_key");
      expect.unreachable("expected error");
    } catch (e) {
      expect(e).toBeInstanceOf(CLIError);
      expect((e as CLIError).code).toBe("invalid_config_key");
      expect((e as CLIError).validValues).toContain("output");
      expect((e as CLIError).hint).toContain("config list");
    }
  });
});
