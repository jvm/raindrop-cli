import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "./helpers/run-cli.js";
import { createMockServer } from "./helpers/mock-server.js";

describe("webhook SSRF protection", () => {
  it("blocks loopback webhook URL by default", async () => {
    const mock = await createMockServer();
    const dir = await mkdtemp(join(tmpdir(), "rd-ssrf-"));
    try {
      mock.addRoute({
        method: "GET",
        path: "/raindrops/0/export.csv",
        status: 200,
        body: "id,title\n",
        headers: { "Content-Type": "text/csv" },
      });
      const result = await runCli(
        [
          "--base-url",
          mock.url,
          "export",
          "bookmarks",
          "0",
          "csv",
          "--deliver",
          "webhook:http://127.0.0.1:9/blocked",
        ],
        { env: { RAINDROP_ACCESS_TOKEN: "test" }, configDir: dir },
      );
      expect(result.code).toBe(2);
      const err = JSON.parse(result.stderr);
      expect(err.error.code).toBe("private_webhook_blocked");
    } finally {
      await mock.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("blocks localhost webhook by default", async () => {
    const mock = await createMockServer();
    const dir = await mkdtemp(join(tmpdir(), "rd-ssrf-"));
    try {
      mock.addRoute({
        method: "GET",
        path: "/raindrops/0/export.csv",
        status: 200,
        body: "id,title\n",
        headers: { "Content-Type": "text/csv" },
      });
      const result = await runCli(
        [
          "--base-url",
          mock.url,
          "export",
          "bookmarks",
          "0",
          "csv",
          "--deliver",
          "webhook:http://localhost:9999/blocked",
        ],
        { env: { RAINDROP_ACCESS_TOKEN: "test" }, configDir: dir },
      );
      expect(result.code).toBe(2);
      const err = JSON.parse(result.stderr);
      expect(err.error.code).toBe("private_webhook_blocked");
    } finally {
      await mock.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("blocks RFC1918 webhook by default", async () => {
    const mock = await createMockServer();
    const dir = await mkdtemp(join(tmpdir(), "rd-ssrf-"));
    try {
      mock.addRoute({
        method: "GET",
        path: "/raindrops/0/export.csv",
        status: 200,
        body: "id,title\n",
        headers: { "Content-Type": "text/csv" },
      });
      const result = await runCli(
        [
          "--base-url",
          mock.url,
          "export",
          "bookmarks",
          "0",
          "csv",
          "--deliver",
          "webhook:http://10.0.0.1:9/blocked",
        ],
        { env: { RAINDROP_ACCESS_TOKEN: "test" }, configDir: dir },
      );
      expect(result.code).toBe(2);
      const err = JSON.parse(result.stderr);
      expect(err.error.code).toBe("private_webhook_blocked");
    } finally {
      await mock.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("allows loopback webhook with --allow-private-webhook", async () => {
    const apiMock = await createMockServer();
    const webhookMock = await createMockServer();
    const dir = await mkdtemp(join(tmpdir(), "rd-ssrf-"));
    try {
      apiMock.addRoute({
        method: "GET",
        path: "/raindrops/0/export.csv",
        status: 200,
        body: "id,title\n",
        headers: { "Content-Type": "text/csv" },
      });
      webhookMock.addRoute({
        method: "POST",
        path: "/hook",
        status: 200,
        body: { result: true },
      });
      const result = await runCli(
        [
          "--base-url",
          apiMock.url,
          "export",
          "bookmarks",
          "0",
          "csv",
          "--deliver",
          `webhook:${webhookMock.url}/hook`,
          "--allow-private-webhook",
        ],
        { env: { RAINDROP_ACCESS_TOKEN: "test" }, configDir: dir },
      );
      expect(result.code).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.delivered_to).toBe(`webhook:${webhookMock.url}/hook`);
    } finally {
      await apiMock.close();
      await webhookMock.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
