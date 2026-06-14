import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "./helpers/run-cli.js";
import { createMockServer } from "./helpers/mock-server.js";

async function setupDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "rd-dedup-"));
  await mkdir(dir, { recursive: true });
  return dir;
}

describe("bookmark add dedup", () => {
  it("returns existing item when URL already exists", async () => {
    const mock = await createMockServer();
    const dir = await setupDir();
    try {
      // Existence check returns existing item
      mock.addRoute({
        method: "POST",
        path: "/import/url/exists",
        status: 200,
        body: {
          result: true,
          item: { _id: 42, link: "https://example.com", title: "Existing" },
        },
      });

      const result = await runCli(
        ["--base-url", `${mock.url}`, "bookmark", "add", "https://example.com"],
        { env: { RAINDROP_ACCESS_TOKEN: "test-token" }, configDir: dir },
      );
      expect(result.code).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.existing).toBe(true);
      expect(parsed.item._id).toBe(42);
    } finally {
      await mock.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("creates bookmark when URL does not exist", async () => {
    const mock = await createMockServer();
    const dir = await setupDir();
    try {
      // Existence check returns no match
      mock.addRoute({
        method: "POST",
        path: "/import/url/exists",
        status: 200,
        body: { result: false },
      });
      // Create endpoint
      mock.addRoute({
        method: "POST",
        path: "/raindrop",
        status: 200,
        body: {
          result: true,
          item: { _id: 100, link: "https://new.example.com", title: "New" },
        },
      });

      const result = await runCli(
        ["--base-url", `${mock.url}`, "bookmark", "add", "https://new.example.com"],
        { env: { RAINDROP_ACCESS_TOKEN: "test-token" }, configDir: dir },
      );
      expect(result.code).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.result).toBe(true);
      // Should have called create
      const createReq = mock.requests.find((r) => r.url === "/raindrop" && r.method === "POST");
      expect(createReq).toBeDefined();
    } finally {
      await mock.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("skips existence check with --allow-duplicate", async () => {
    const mock = await createMockServer();
    const dir = await setupDir();
    try {
      // Only the create endpoint should be called, not the existence check
      mock.addRoute({
        method: "POST",
        path: "/raindrop",
        status: 200,
        body: {
          result: true,
          item: { _id: 200, link: "https://dup.example.com" },
        },
      });

      const result = await runCli(
        [
          "--base-url",
          `${mock.url}`,
          "bookmark",
          "add",
          "https://dup.example.com",
          "--allow-duplicate",
        ],
        { env: { RAINDROP_ACCESS_TOKEN: "test-token" }, configDir: dir },
      );
      expect(result.code).toBe(0);
      // Should NOT have called import/url/exists
      const existsReq = mock.requests.find((r) => r.url?.includes("/import/url/exists"));
      expect(existsReq).toBeUndefined();
    } finally {
      await mock.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("--dry-run does not make network calls to create", async () => {
    const mock = await createMockServer();
    const dir = await setupDir();
    try {
      mock.addRoute({
        method: "POST",
        path: "/import/url/exists",
        status: 200,
        body: { result: false },
      });

      const result = await runCli(
        [
          "--base-url",
          `${mock.url}`,
          "bookmark",
          "add",
          "https://dry.example.com",
          "--dry-run",
          "--allow-duplicate",
        ],
        { env: { RAINDROP_ACCESS_TOKEN: "test-token" }, configDir: dir },
      );
      expect(result.code).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.dry_run).toBe(true);
      expect(parsed.request).toBeDefined();
      // No create call
      const createReq = mock.requests.find((r) => r.url === "/raindrop" && r.method === "POST");
      expect(createReq).toBeUndefined();
    } finally {
      await mock.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("sends collection, tags, important in request body", async () => {
    const mock = await createMockServer();
    const dir = await setupDir();
    try {
      mock.addRoute({
        method: "POST",
        path: "/raindrop",
        status: 200,
        body: { result: true, item: { _id: 300 } },
      });

      await runCli(
        [
          "--base-url",
          `${mock.url}`,
          "bookmark",
          "add",
          "https://tagged.example.com",
          "--allow-duplicate",
          "--collection",
          "42",
          "--tag",
          "api",
          "--tag",
          "docs",
          "--important",
        ],
        { env: { RAINDROP_ACCESS_TOKEN: "test-token" }, configDir: dir },
      );

      const createReq = mock.requests.find((r) => r.url === "/raindrop" && r.method === "POST");
      expect(createReq).toBeDefined();
      const body = createReq!.body as any;
      expect(body.link).toBe("https://tagged.example.com");
      expect(body.collection).toEqual({ $id: 42 });
      expect(body.tags).toEqual(["api", "docs"]);
      expect(body.important).toBe(true);
    } finally {
      await mock.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
