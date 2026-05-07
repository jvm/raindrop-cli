import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const runProcess = promisify(execFile);

async function run(
  args: string[],
  env: Record<string, string> = {},
  configDir?: string,
) {
  const dir = configDir ?? (await mkdtemp(join(tmpdir(), "rd-cfgflag-")));
  try {
    return await runProcess("pnpm", ["tsx", "src/cli.ts", ...args], {
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
    if (!configDir) await rm(dir, { recursive: true, force: true });
  }
}

describe("--config flag", () => {
  it("config path reflects --config override", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rd-cfgflag-"));
    const customCfg = join(dir, "custom-config.toml");
    try {
      await writeFile(customCfg, 'output = "human"\n', "utf8");
      const result = await run(
        ["--json", "--config", customCfg, "config", "path"],
        {},
        dir,
      );
      expect(result.code).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.path).toBe(customCfg);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("config list reads values from --config target", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rd-cfgflag-"));
    const customCfg = join(dir, "alt.toml");
    try {
      await writeFile(customCfg, 'output = "human"\nmax_retries = 7\n', "utf8");
      const result = await run(
        ["--config", customCfg, "--json", "config", "list"],
        {},
        dir,
      );
      expect(result.code).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.values.max_retries.value).toBe(7);
      expect(parsed.values.max_retries.source).toBe("file");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
