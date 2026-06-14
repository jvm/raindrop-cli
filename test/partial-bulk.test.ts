import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "./helpers/run-cli.js";
import { createMockServer } from "./helpers/mock-server.js";

describe("partial bulk exit code", () => {
  it("bulk-update returns exit 6 when modified < requested", async () => {
    const mock = await createMockServer();
    const dir = await mkdtemp(join(tmpdir(), "rd-partial-"));
    try {
      mock.addRoute({
        method: "PUT",
        path: "/raindrops/123",
        status: 200,
        body: { result: true, modified: 1 },
      });
      const result = await runCli(
        [
          "--base-url",
          mock.url,
          "bookmark",
          "bulk-update",
          "--collection",
          "123",
          "--ids",
          "1,2,3",
          "--tag",
          "archived",
        ],
        { env: { RAINDROP_ACCESS_TOKEN: "test" }, configDir: dir },
      );
      expect(result.code).toBe(6);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.partial).toBe(true);
      expect(parsed.expected_count).toBe(3);
      expect(parsed.modified_count).toBe(1);
    } finally {
      await mock.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("bulk-delete returns exit 6 on partial delete", async () => {
    const mock = await createMockServer();
    const dir = await mkdtemp(join(tmpdir(), "rd-partial-"));
    try {
      mock.addRoute({
        method: "DELETE",
        path: "/raindrops/123",
        status: 200,
        body: { result: true, modified: 2 },
      });
      const result = await runCli(
        [
          "--base-url",
          mock.url,
          "bookmark",
          "bulk-delete",
          "--collection",
          "123",
          "--ids",
          "1,2,3,4",
          "--force",
        ],
        { env: { RAINDROP_ACCESS_TOKEN: "test" }, configDir: dir },
      );
      expect(result.code).toBe(6);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.partial).toBe(true);
      expect(parsed.modified_count).toBe(2);
      expect(parsed.expected_count).toBe(4);
    } finally {
      await mock.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("bulk-create returns exit 6 when fewer items returned than sent", async () => {
    const mock = await createMockServer();
    const dir = await mkdtemp(join(tmpdir(), "rd-partial-"));
    try {
      mock.addRoute({
        method: "POST",
        path: "/raindrops",
        status: 200,
        body: { result: true, items: [{ _id: 1 }] },
      });
      const body = {
        items: [{ link: "https://a.example" }, { link: "https://b.example" }],
      };
      const result = await runCli(
        ["--base-url", mock.url, "bookmark", "bulk-create", "-d", JSON.stringify(body)],
        { env: { RAINDROP_ACCESS_TOKEN: "test" }, configDir: dir },
      );
      expect(result.code).toBe(6);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.partial).toBe(true);
      expect(parsed.expected_count).toBe(2);
      expect(parsed.modified_count).toBe(1);
    } finally {
      await mock.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("delete-many returns exit 6 on partial delete", async () => {
    const mock = await createMockServer();
    const dir = await mkdtemp(join(tmpdir(), "rd-partial-"));
    try {
      mock.addRoute({
        method: "DELETE",
        path: "/collections",
        status: 200,
        body: { result: true, modified: 1 },
      });
      const result = await runCli(
        ["--base-url", mock.url, "collection", "delete-many", "1", "2", "3", "--force"],
        { env: { RAINDROP_ACCESS_TOKEN: "test" }, configDir: dir },
      );
      expect(result.code).toBe(6);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.partial).toBe(true);
    } finally {
      await mock.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("bulk-update returns exit 0 when all modified", async () => {
    const mock = await createMockServer();
    const dir = await mkdtemp(join(tmpdir(), "rd-partial-"));
    try {
      mock.addRoute({
        method: "PUT",
        path: "/raindrops/123",
        status: 200,
        body: { result: true, modified: 3 },
      });
      const result = await runCli(
        [
          "--base-url",
          mock.url,
          "bookmark",
          "bulk-update",
          "--collection",
          "123",
          "--ids",
          "1,2,3",
          "--tag",
          "archived",
        ],
        { env: { RAINDROP_ACCESS_TOKEN: "test" }, configDir: dir },
      );
      expect(result.code).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.partial).toBeUndefined();
    } finally {
      await mock.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
