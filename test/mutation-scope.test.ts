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
  const dir = configDir ?? (await mkdtemp(join(tmpdir(), "rd-scope-")));
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

describe("mutation scope on bookmark commands", () => {
  it("bookmark add JSON includes target without collection title lookup", async () => {
    const mock = await createMockServer();
    const dir = await mkdtemp(join(tmpdir(), "rd-scope-"));
    try {
      mock.addRoute({
        method: "POST",
        path: "/import/url/exists",
        status: 200,
        body: { result: false },
      });
      mock.addRoute({
        method: "POST",
        path: "/raindrop",
        status: 200,
        body: { result: true, item: { _id: 1, link: "https://x.example" } },
      });
      mock.addRoute({
        method: "GET",
        path: "/collection/123",
        status: 200,
        body: { result: true, item: { _id: 123, title: "Reading list" } },
      });
      const result = await run(
        [
          "--base-url",
          mock.url,
          "bookmark",
          "add",
          "https://x.example",
          "--collection",
          "123",
        ],
        { RAINDROP_ACCESS_TOKEN: "tok" },
        dir,
      );
      expect(result.code).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.target).toBeDefined();
      expect(parsed.target.profile).toBe("default");
      expect(parsed.target.collection_id).toBe(123);
      expect(parsed.target.collection_title).toBeUndefined();
      const lookup = mock.requests.find((r) =>
        r.url.startsWith("/collection/123"),
      );
      expect(lookup).toBeUndefined();
    } finally {
      await mock.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("--human prints scope header to stderr before the result", async () => {
    const mock = await createMockServer();
    const dir = await mkdtemp(join(tmpdir(), "rd-scope-"));
    try {
      mock.addRoute({
        method: "POST",
        path: "/import/url/exists",
        status: 200,
        body: { result: false },
      });
      mock.addRoute({
        method: "POST",
        path: "/raindrop",
        status: 200,
        body: { result: true, item: { _id: 1, link: "https://y.example" } },
      });
      mock.addRoute({
        method: "GET",
        path: "/collection/0",
        status: 200,
        body: { result: true, item: { _id: 0, title: "All" } },
      });
      const result = await run(
        [
          "--human",
          "--base-url",
          mock.url,
          "bookmark",
          "add",
          "https://y.example",
          "--collection",
          "0",
        ],
        { RAINDROP_ACCESS_TOKEN: "tok" },
        dir,
      );
      expect(result.code).toBe(0);
      expect(result.stderr).toMatch(/-> profile=default collection=/);
    } finally {
      await mock.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("system collection -1 resolves to Unsorted without an extra fetch", async () => {
    const mock = await createMockServer();
    const dir = await mkdtemp(join(tmpdir(), "rd-scope-"));
    try {
      mock.addRoute({
        method: "POST",
        path: "/import/url/exists",
        status: 200,
        body: { result: false },
      });
      mock.addRoute({
        method: "POST",
        path: "/raindrop",
        status: 200,
        body: { result: true, item: { _id: 1 } },
      });
      const result = await run(
        [
          "--base-url",
          mock.url,
          "bookmark",
          "add",
          "https://z.example",
          "--collection",
          "-1",
        ],
        { RAINDROP_ACCESS_TOKEN: "tok" },
        dir,
      );
      expect(result.code).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.target.collection_id).toBe(-1);
      expect(parsed.target.collection_title).toBe("Unsorted");
      // No /collection/-1 GET should have been made
      const lookup = mock.requests.find((r) =>
        r.url.startsWith("/collection/-1"),
      );
      expect(lookup).toBeUndefined();
    } finally {
      await mock.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
