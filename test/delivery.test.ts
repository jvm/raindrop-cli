import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  const dir = configDir ?? (await mkdtemp(join(tmpdir(), "rd-delivery-")));
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

async function setupDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "rd-delivery-"));
}

describe("delivery", () => {
  it("writes file atomically via --output", async () => {
    const mock = await createMockServer();
    const dir = await setupDir();
    const outDir = await mkdtemp(join(tmpdir(), "rd-out-"));
    try {
      mock.addRoute({
        method: "GET",
        path: "/raindrops/0/export.csv",
        status: 200,
        body: "id,title\n1,Test\n",
        headers: { "Content-Type": "text/csv" },
      });

      const result = await run(
        [
          "--base-url",
          `${mock.url}`,
          "export",
          "bookmarks",
          "0",
          "csv",
          "--output",
          join(outDir, "test.csv"),
        ],
        { RAINDROP_ACCESS_TOKEN: "test-token" },
        dir,
      );
      expect(result.code).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.result).toBe(true);
      expect(parsed.path).toBe(join(outDir, "test.csv"));
      expect(parsed.bytes).toBeGreaterThan(0);

      // File should exist and have content
      const content = await readFile(join(outDir, "test.csv"), "utf8");
      expect(content).toContain("id,title");
    } finally {
      await mock.close();
      await rm(dir, { recursive: true, force: true });
      await rm(outDir, { recursive: true, force: true });
    }
  });

  it("refuses to overwrite existing file without --force", async () => {
    const mock = await createMockServer();
    const dir = await setupDir();
    const outDir = await mkdtemp(join(tmpdir(), "rd-out-"));
    try {
      // Create an existing file
      await writeFile(join(outDir, "exists.csv"), "old content", "utf8");

      mock.addRoute({
        method: "GET",
        path: "/raindrops/0/export.csv",
        status: 200,
        body: "new content",
      });

      const result = await run(
        [
          "--base-url",
          `${mock.url}`,
          "export",
          "bookmarks",
          "0",
          "csv",
          "--output",
          join(outDir, "exists.csv"),
        ],
        { RAINDROP_ACCESS_TOKEN: "test-token" },
        dir,
      );
      expect(result.code).not.toBe(0);
      const err = JSON.parse(result.stderr);
      expect(err.error.code).toBe("output_exists");

      // Original file should be unchanged
      const content = await readFile(join(outDir, "exists.csv"), "utf8");
      expect(content).toBe("old content");
    } finally {
      await mock.close();
      await rm(dir, { recursive: true, force: true });
      await rm(outDir, { recursive: true, force: true });
    }
  });

  it("overwrites existing file with --force", async () => {
    const mock = await createMockServer();
    const dir = await setupDir();
    const outDir = await mkdtemp(join(tmpdir(), "rd-out-"));
    try {
      await writeFile(join(outDir, "old.csv"), "old", "utf8");

      mock.addRoute({
        method: "GET",
        path: "/raindrops/0/export.csv",
        status: 200,
        body: "new content",
        headers: { "Content-Type": "text/csv" },
      });

      const result = await run(
        [
          "--base-url",
          `${mock.url}`,
          "export",
          "bookmarks",
          "0",
          "csv",
          "--output",
          join(outDir, "old.csv"),
          "--force",
        ],
        { RAINDROP_ACCESS_TOKEN: "test-token" },
        dir,
      );
      expect(result.code).toBe(0);

      const content = await readFile(join(outDir, "old.csv"), "utf8");
      expect(content).toBe('"new content"');
    } finally {
      await mock.close();
      await rm(dir, { recursive: true, force: true });
      await rm(outDir, { recursive: true, force: true });
    }
  });

  it("rejects --output and --deliver together", async () => {
    const dir = await setupDir();
    try {
      const result = await run(
        [
          "export",
          "bookmarks",
          "0",
          "csv",
          "--output",
          "a.csv",
          "--deliver",
          "file:b.csv",
        ],
        { RAINDROP_ACCESS_TOKEN: "test-token" },
        dir,
      );
      expect(result.code).toBe(2);
      const err = JSON.parse(result.stderr);
      expect(err.error.code).toBe("delivery_conflict");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects unsupported delivery schemes before network", async () => {
    const dir = await setupDir();
    try {
      const result = await run(
        ["export", "bookmarks", "0", "csv", "--deliver", "ftp://bad"],
        { RAINDROP_ACCESS_TOKEN: "test-token" },
        dir,
      );
      expect(result.code).toBe(2);
      const err = JSON.parse(result.stderr);
      expect(err.error.code).toBe("invalid_delivery");
      expect(err.error.valid_values).toBeDefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
