import { mkdir, rm, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

async function run(
  args: string[],
  env: Record<string, string> = {},
  configDir?: string,
) {
  const dir = configDir ?? (await mkdtemp(join(tmpdir(), "rd-runtime-")));
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
    if (!configDir) await rm(dir, { recursive: true, force: true });
  }
}

async function setupConfigDir(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "rd-runtime-"));
  await mkdir(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    await writeFile(
      join(dir, name),
      content,
      name === "credentials.json" ? { mode: 0o600 } : undefined,
    );
  }
  return dir;
}

describe("runtime precedence", () => {
  it("defaults to json output", async () => {
    const dir = await setupConfigDir({});
    try {
      const result = await run(["config", "list"], {}, dir);
      expect(result.code).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.values.output.value).toBe("json");
      expect(parsed.values.output.source).toBe("default");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("config file sets output to human", async () => {
    const dir = await setupConfigDir({
      "config.toml": 'output = "human"',
    });
    try {
      const result = await run(["config", "list"], {}, dir);
      expect(result.code).toBe(0);
      // Output should be human because config sets output=human
      expect(result.stdout).not.toMatch(/^\s*\{/);
      expect(result.stdout).toContain("output:");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("env var overrides config file", async () => {
    const dir = await setupConfigDir({
      "config.toml": 'output = "human"',
    });
    try {
      const result = await run(
        ["config", "list"],
        { RAINDROP_OUTPUT: "json" },
        dir,
      );
      expect(result.code).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.values.output.value).toBe("json");
      expect(parsed.values.output.source).toBe("env");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("--human flag overrides env var", async () => {
    const dir = await setupConfigDir({});
    try {
      // --json forces JSON even when config says human
      const result = await run(["--json", "config", "list"], {}, dir);
      expect(result.code).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.values.output.value).toBe("json");
      expect(parsed.values.output.source).toBe("flag");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("profile defaults override config file defaults", async () => {
    const dir = await setupConfigDir({
      "config.toml": 'default_collection = 0\noutput = "json"',
      "profiles.json": JSON.stringify({
        profiles: {
          work: { default_collection: 123456, output: "human" },
        },
      }),
    });
    try {
      const result = await run(
        ["--json", "--profile", "work", "config", "list"],
        {},
        dir,
      );
      expect(result.code).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.values.default_collection.value).toBe(123456);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("env RAINDROP_PROFILE selects profile", async () => {
    const dir = await setupConfigDir({
      "profiles.json": JSON.stringify({
        profiles: {
          work: { default_collection: 999 },
        },
      }),
    });
    try {
      const result = await run(
        ["config", "list"],
        { RAINDROP_PROFILE: "work" },
        dir,
      );
      expect(result.code).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.values.default_collection.value).toBe(999);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("base_url from env overrides config", async () => {
    const dir = await setupConfigDir({
      "config.toml": 'base_url = "https://custom.api/v1"',
    });
    try {
      const result = await run(
        ["config", "list"],
        { RAINDROP_BASE_URL: "https://env.api/v1" },
        dir,
      );
      expect(result.code).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.values.base_url.value).toBe("https://env.api/v1");
      expect(parsed.values.base_url.source).toBe("env");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("max_retries from config is respected", async () => {
    const dir = await setupConfigDir({
      "config.toml": "max_retries = 5",
    });
    try {
      const result = await run(["config", "list"], {}, dir);
      expect(result.code).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.values.max_retries.value).toBe(5);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
