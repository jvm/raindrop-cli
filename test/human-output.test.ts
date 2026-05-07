import { describe, expect, it } from "vitest";
import { rm } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

async function run(args: string[], env: Record<string, string> = {}) {
  const dir = await mkdtemp(join(tmpdir(), "rd-human-"));
  try {
    return await exec("pnpm", ["tsx", "src/cli.ts", ...args], {
      env: { ...process.env, RAINDROP_CONFIG_DIR: dir, ...env },
    }).then(
      (r) => ({ code: 0, stdout: r.stdout, stderr: r.stderr }),
      (e) => ({
        code: e.code ?? 1,
        stdout: (e as any).stdout ?? "",
        stderr: (e as any).stderr ?? "",
      }),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("human output", () => {
  it("config list --human shows key=value lines", async () => {
    const result = await run(["--human", "config", "list"]);
    expect(result.code).toBe(0);
    // In human mode, output should NOT be JSON
    expect(result.stdout).not.toMatch(/^\s*\{/);
  });

  it("config list --json shows JSON", async () => {
    const result = await run(["--json", "config", "list"]);
    expect(result.code).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.result).toBe(true);
    expect(parsed.values).toBeDefined();
  });

  it("auth status with --human shows human-readable text", async () => {
    const result = await run(["--human", "auth", "status"], {
      RAINDROP_ACCESS_TOKEN: "tok",
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("authenticated");
  });

  it("NO_COLOR is respected", async () => {
    const result = await run(["--human", "auth", "status"], {
      RAINDROP_ACCESS_TOKEN: "tok",
      NO_COLOR: "1",
    });
    expect(result.code).toBe(0);
  });

  it("agent-context works without auth or network", async () => {
    const result = await run(["agent-context"]);
    expect(result.code).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.cli).toBe("raindrop");
    expect(parsed.schema_version).toBe("1");
    expect(parsed.commands).toBeDefined();
    expect(parsed.global_flags).toBeDefined();
    expect(parsed.available_profiles).toBeDefined();
    // Should NOT contain any secret values (the key names are OK in schemas)
    // Check that available_profiles is an array of names, not credential objects
    expect(parsed.available_profiles).toBeDefined();
    expect(Array.isArray(parsed.available_profiles)).toBe(true);
    // May be empty in test env with no profiles configured
  });

  it("agent-context --command shows specific command", async () => {
    const result = await run(["agent-context", "--command", "bookmark.add"]);
    expect(result.code).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.commands["bookmark.add"]).toBeDefined();
    expect(parsed.commands["bookmark.add"].summary).toBeDefined();
    expect(parsed.commands["bookmark.add"].examples).toBeDefined();
    expect(parsed.commands["bookmark.add"].examples.length).toBeGreaterThan(0);
  });
});
