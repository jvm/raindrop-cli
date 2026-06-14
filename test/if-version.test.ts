import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "./helpers/run-cli.js";
import { createMockServer } from "./helpers/mock-server.js";

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
      const result = await runCli(
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
        { env: { RAINDROP_ACCESS_TOKEN: "test" }, configDir: dir },
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
      const result = await runCli(
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
        { env: { RAINDROP_ACCESS_TOKEN: "test" }, configDir: dir },
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
      const result = await runCli(
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
        { env: { RAINDROP_ACCESS_TOKEN: "test" }, configDir: dir },
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
