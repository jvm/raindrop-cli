import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createMockServer } from "./helpers/mock-server.js";

const runProcess = promisify(execFile);

async function run(
  args: string[],
  env: Record<string, string> = {},
  configDir?: string,
) {
  const dir = configDir ?? (await mkdtemp(join(tmpdir(), "rd-ifver-")));
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

describe("highlight --if-version", () => {
  it("rejects on lastUpdate mismatch with exit 2", async () => {
    const mock = await createMockServer();
    const dir = await mkdtemp(join(tmpdir(), "rd-ifver-"));
    try {
      mock.addRoute({
        method: "GET",
        path: "/raindrop/42",
        status: 200,
        body: {
          result: true,
          item: {
            _id: 42,
            highlights: [],
            lastUpdate: "2026-01-01T00:00:00Z",
          },
        },
      });
      const result = await run(
        [
          "--base-url",
          mock.url,
          "highlight",
          "add",
          "42",
          "--text",
          "quote",
          "--color",
          "yellow",
          "--if-version",
          "2025-12-31T00:00:00Z",
        ],
        { RAINDROP_ACCESS_TOKEN: "test" },
        dir,
      );
      expect(result.code).toBe(2);
      const err = JSON.parse(result.stderr);
      expect(err.error.code).toBe("version_mismatch");
    } finally {
      await mock.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("proceeds when --if-version matches lastUpdate", async () => {
    const mock = await createMockServer();
    const dir = await mkdtemp(join(tmpdir(), "rd-ifver-"));
    try {
      mock.addRoute({
        method: "GET",
        path: "/raindrop/42",
        status: 200,
        body: {
          result: true,
          item: {
            _id: 42,
            highlights: [],
            lastUpdate: "2026-05-06T12:00:00Z",
          },
        },
      });
      mock.addRoute({
        method: "PUT",
        path: "/raindrop/42",
        status: 200,
        body: { result: true, item: { _id: 42 } },
      });
      const result = await run(
        [
          "--base-url",
          mock.url,
          "highlight",
          "add",
          "42",
          "--text",
          "quote",
          "--color",
          "yellow",
          "--if-version",
          "2026-05-06T12:00:00Z",
        ],
        { RAINDROP_ACCESS_TOKEN: "test" },
        dir,
      );
      expect(result.code).toBe(0);
    } finally {
      await mock.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects when bookmark has no lastUpdate field", async () => {
    const mock = await createMockServer();
    const dir = await mkdtemp(join(tmpdir(), "rd-ifver-"));
    try {
      mock.addRoute({
        method: "GET",
        path: "/raindrop/42",
        status: 200,
        body: { result: true, item: { _id: 42, highlights: [] } },
      });
      const result = await run(
        [
          "--base-url",
          mock.url,
          "highlight",
          "delete",
          "42",
          "abc",
          "--force",
          "--if-version",
          "v1",
        ],
        { RAINDROP_ACCESS_TOKEN: "test" },
        dir,
      );
      expect(result.code).toBe(2);
      const err = JSON.parse(result.stderr);
      expect(err.error.code).toBe("version_unknown");
    } finally {
      await mock.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
