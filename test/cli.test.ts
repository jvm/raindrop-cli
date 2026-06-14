import { describe, expect, it } from "vitest";
import { runCli } from "./helpers/run-cli.js";

describe("cli contracts", () => {
  it("prints agent context without auth", async () => {
    const result = await runCli(["agent-context"]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).cli).toBe("raindrop");
  });

  it("returns structured missing-auth errors", async () => {
    const result = await runCli(["auth", "status"]);
    expect(result.code).toBe(3);
    expect(JSON.parse(result.stderr).error.code).toBe("auth_missing");
  });

  it("requires force for destructive commands", async () => {
    const result = await runCli(["bookmark", "delete", "123"], {
      env: { RAINDROP_ACCESS_TOKEN: "token" },
    });
    expect(result.code).toBe(2);
    expect(JSON.parse(result.stderr).error.code).toBe("force_required");
  });
});
