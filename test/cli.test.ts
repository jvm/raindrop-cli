import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const exec = promisify(execFile);

async function run(args: string[], env: Record<string, string> = {}) {
  const dir = await mkdtemp(join(tmpdir(), "raindrop-test-"));
  try {
    return await exec("pnpm", ["tsx", "src/cli.ts", ...args], {
      env: { ...process.env, RAINDROP_CONFIG_DIR: dir, ...env },
    }).then(
      (r) => ({ code: 0, stdout: r.stdout, stderr: r.stderr }),
      (e) => ({
        code: e.code ?? 1,
        stdout: e.stdout ?? "",
        stderr: e.stderr ?? "",
      }),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("cli contracts", () => {
  it("prints agent context without auth", async () => {
    const result = await run(["agent-context"]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).cli).toBe("raindrop");
  });

  it("returns structured missing-auth errors", async () => {
    const result = await run(["auth", "status"]);
    expect(result.code).toBe(3);
    expect(JSON.parse(result.stderr).error.code).toBe("auth_missing");
  });

  it("requires force for destructive commands", async () => {
    const result = await run(["bookmark", "delete", "123"], {
      RAINDROP_ACCESS_TOKEN: "token",
    });
    expect(result.code).toBe(2);
    expect(JSON.parse(result.stderr).error.code).toBe("force_required");
  });
});
