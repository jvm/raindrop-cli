import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "./helpers/run-cli.js";

describe("--config flag", () => {
  it("config path reflects --config override", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rd-cfgflag-"));
    const customCfg = join(dir, "custom-config.toml");
    try {
      await writeFile(customCfg, 'output = "human"\n', "utf8");
      const result = await runCli(
        ["--json", "--config", customCfg, "config", "path"],
        { configDir: dir },
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
      const result = await runCli(
        ["--config", customCfg, "--json", "config", "list"],
        { configDir: dir },
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
