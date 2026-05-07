import { rm } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createMockServer } from "./helpers/mock-server.js";

const exec = promisify(execFile);

async function run(
  args: string[],
  env: Record<string, string> = {},
  configDir?: string,
) {
  const dir = configDir ?? (await mkdtemp(join(tmpdir(), "rd-import-")));
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

describe("import commands", () => {
  it("import exists treats result:false as data with exit 0", async () => {
    const mock = await createMockServer();
    const dir = await mkdtemp(join(tmpdir(), "rd-import-"));
    try {
      // URL does not exist — API returns result:false
      mock.addRoute({
        method: "POST",
        path: "/import/url/exists",
        status: 200,
        body: { result: false },
      });

      const result = await run(
        [
          "--base-url",
          `${mock.url}`,
          "import",
          "exists",
          "https://new.example.com",
        ],
        { RAINDROP_ACCESS_TOKEN: "test-token" },
        dir,
      );
      expect(result.code).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.result).toBe(true); // Our wrapper forces result:true
    } finally {
      await mock.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("import exists returns match data when URL exists", async () => {
    const mock = await createMockServer();
    const dir = await mkdtemp(join(tmpdir(), "rd-import-"));
    try {
      mock.addRoute({
        method: "POST",
        path: "/import/url/exists",
        status: 200,
        body: {
          result: true,
          item: { _id: 42, link: "https://found.example.com" },
        },
      });

      const result = await run(
        [
          "--base-url",
          `${mock.url}`,
          "import",
          "exists",
          "https://found.example.com",
        ],
        { RAINDROP_ACCESS_TOKEN: "test-token" },
        dir,
      );
      expect(result.code).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.result).toBe(true);
    } finally {
      await mock.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
