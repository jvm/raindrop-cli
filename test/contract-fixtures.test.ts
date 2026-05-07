import { describe, expect, it } from "vitest";
import { rm } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createMockServer } from "./helpers/mock-server.js";

const exec = promisify(execFile);

async function run(
  args: string[],
  env: Record<string, string> = {},
  configDir?: string,
) {
  const dir = configDir ?? (await mkdtemp(join(tmpdir(), "rd-fixture-")));
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

describe("contract fixture tests", () => {
  it("preserves unknown API fields in user get", async () => {
    const mock = await createMockServer();
    const dir = await mkdtemp(join(tmpdir(), "rd-fixture-"));
    try {
      mock.addRoute({
        method: "GET",
        path: "/user",
        status: 200,
        body: {
          result: true,
          user: {
            _id: 42,
            email: "test@example.com",
            fullName: "Test User",
            pro: true,
            // Undocumented fields that should be preserved
            customField: "should-be-preserved",
            nested: { extra: true },
          },
        },
      });

      const result = await run(
        ["--base-url", `${mock.url}`, "user", "get"],
        { RAINDROP_ACCESS_TOKEN: "tok" },
        dir,
      );
      expect(result.code).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.user.customField).toBe("should-be-preserved");
      expect(parsed.user.nested.extra).toBe(true);
    } finally {
      await mock.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("preserves unknown fields in bookmark list items", async () => {
    const mock = await createMockServer();
    const dir = await mkdtemp(join(tmpdir(), "rd-fixture-"));
    try {
      mock.addRoute({
        method: "GET",
        path: "/raindrops/0",
        status: 200,
        body: {
          result: true,
          items: [
            {
              _id: 1,
              title: "Test",
              link: "https://example.com",
              // Undocumented fields
              cache: { status: "ready", size: 1234 },
              media: [{ type: "image", url: "https://img.example.com/1.jpg" }],
            },
          ],
          count: 1,
        },
      });

      const result = await run(
        ["--base-url", `${mock.url}`, "bookmark", "list", "--collection", "0"],
        { RAINDROP_ACCESS_TOKEN: "tok" },
        dir,
      );
      expect(result.code).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.items[0].cache.status).toBe("ready");
      expect(parsed.items[0].media[0].type).toBe("image");
    } finally {
      await mock.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("preserves unknown fields in collection get", async () => {
    const mock = await createMockServer();
    const dir = await mkdtemp(join(tmpdir(), "rd-fixture-"));
    try {
      mock.addRoute({
        method: "GET",
        path: "/collection/123",
        status: 200,
        body: {
          result: true,
          item: {
            _id: 123,
            title: "Test Collection",
            count: 42,
            // Undocumented fields
            color: "#ff0000",
            cover: ["https://cover.example.com/1.jpg"],
            view: "grid",
          },
        },
      });

      const result = await run(
        ["--base-url", `${mock.url}`, "collection", "get", "123"],
        { RAINDROP_ACCESS_TOKEN: "tok" },
        dir,
      );
      expect(result.code).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.item.color).toBe("#ff0000");
      expect(parsed.item.cover).toHaveLength(1);
    } finally {
      await mock.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
