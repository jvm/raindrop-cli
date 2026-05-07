import { describe, expect, it } from "vitest";
import { rm } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

async function run(args: string[], env: Record<string, string> = {}) {
  const dir = await mkdtemp(join(tmpdir(), "rd-doctor-"));
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

describe("doctor", () => {
  it("runs config parseable check", async () => {
    const result = await run(["doctor"]);
    expect(result.code).not.toBe(2); // not a usage error
    const parsed = JSON.parse(result.stdout);
    expect(parsed.checks).toBeDefined();
    const configCheck = parsed.checks.find(
      (c: any) => c.name === "config_parseable",
    );
    expect(configCheck).toBeDefined();
    expect(configCheck.ok).toBe(true);
  });

  it("detects missing auth", async () => {
    const result = await run(["doctor"]);
    const parsed = JSON.parse(result.stdout);
    const authCheck = parsed.checks.find((c: any) => c.name === "auth_token");
    expect(authCheck).toBeDefined();
    // Without token, auth should fail
    expect(authCheck.ok).toBe(false);
  });

  it("passes auth check with env token", async () => {
    const result = await run(["doctor"], {
      RAINDROP_ACCESS_TOKEN: "fake-token",
    });
    const parsed = JSON.parse(result.stdout);
    const authCheck = parsed.checks.find((c: any) => c.name === "auth_token");
    expect(authCheck.ok).toBe(true);
    expect(authCheck.source).toBe("env");
  });

  it("checks state dir writable", async () => {
    const result = await run(["doctor"]);
    const parsed = JSON.parse(result.stdout);
    const stateCheck = parsed.checks.find(
      (c: any) => c.name === "state_dir_writable",
    );
    expect(stateCheck).toBeDefined();
    expect(stateCheck.ok).toBe(true);
  });

  it("checks api connectivity", async () => {
    const result = await run(["doctor"]);
    const parsed = JSON.parse(result.stdout);
    const connCheck = parsed.checks.find(
      (c: any) => c.name === "api_connectivity",
    );
    expect(connCheck).toBeDefined();
  });
});
