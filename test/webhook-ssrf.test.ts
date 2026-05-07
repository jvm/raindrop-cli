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
  const dir = configDir ?? (await mkdtemp(join(tmpdir(), "rd-ssrf-")));
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
      const result = await run(
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
        { RAINDROP_ACCESS_TOKEN: "test" },
        dir,
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
      const result = await run(
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
        { RAINDROP_ACCESS_TOKEN: "test" },
        dir,
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
      const result = await run(
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
        { RAINDROP_ACCESS_TOKEN: "test" },
        dir,
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
      const result = await run(
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
        { RAINDROP_ACCESS_TOKEN: "test" },
        dir,
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
