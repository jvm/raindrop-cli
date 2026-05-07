import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
  const dir = configDir ?? (await mkdtemp(join(tmpdir(), "rd-refresh-")));
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

describe("proactive token refresh near expiry", () => {
  it("refreshes before request when expires_at is within skew window", async () => {
    const mock = await createMockServer();
    const dir = await mkdtemp(join(tmpdir(), "rd-refresh-"));
    try {
      const expiresAt = new Date(Date.now() + 10_000).toISOString(); // 10s from now
      await mkdir(dir, { recursive: true });
      await writeFile(
        join(dir, "credentials.json"),
        JSON.stringify({
          profiles: {
            default: {
              access_token: "stale-token",
              refresh_token: "rt-123",
              client_id: "cid",
              client_secret: "csecret",
              token_type: "Bearer",
              expires_at: expiresAt,
            },
          },
        }),
        { mode: 0o600 },
      );
      mock.addRoute({
        method: "POST",
        path: "/oauth/access_token",
        status: 200,
        body: {
          access_token: "fresh-token",
          refresh_token: "rt-456",
          expires_in: 1209600,
          token_type: "Bearer",
        },
      });
      mock.addRoute({
        method: "GET",
        path: "/user",
        status: 200,
        body: { result: true, user: { _id: 1, email: "me@example.com" } },
      });
      const result = await run(
        ["--base-url", mock.url, "user", "get"],
        { RAINDROP_TOKEN_URL: `${mock.url}/oauth/access_token` },
        dir,
      );
      expect(result.code).toBe(0);
      // The request to /user should have used the fresh token
      const userRequest = mock.requests.find((r) => r.url === "/user");
      expect(userRequest).toBeDefined();
      expect(userRequest!.headers["authorization"]).toBe("Bearer fresh-token");
      // The refresh endpoint should have been called
      const refreshRequest = mock.requests.find(
        (r) => r.url === "/oauth/access_token",
      );
      expect(refreshRequest).toBeDefined();
    } finally {
      await mock.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not refresh when expires_at is far in the future", async () => {
    const mock = await createMockServer();
    const dir = await mkdtemp(join(tmpdir(), "rd-refresh-"));
    try {
      const expiresAt = new Date(Date.now() + 3600_000).toISOString(); // 1h from now
      await mkdir(dir, { recursive: true });
      await writeFile(
        join(dir, "credentials.json"),
        JSON.stringify({
          profiles: {
            default: {
              access_token: "fresh-enough",
              refresh_token: "rt-123",
              client_id: "cid",
              client_secret: "csecret",
              token_type: "Bearer",
              expires_at: expiresAt,
            },
          },
        }),
        { mode: 0o600 },
      );
      mock.addRoute({
        method: "GET",
        path: "/user",
        status: 200,
        body: { result: true, user: { _id: 1 } },
      });
      const result = await run(
        ["--base-url", mock.url, "user", "get"],
        { RAINDROP_TOKEN_URL: `${mock.url}/oauth/access_token` },
        dir,
      );
      expect(result.code).toBe(0);
      const userRequest = mock.requests.find((r) => r.url === "/user");
      expect(userRequest!.headers["authorization"]).toBe("Bearer fresh-enough");
      const refreshRequest = mock.requests.find(
        (r) => r.url === "/oauth/access_token",
      );
      expect(refreshRequest).toBeUndefined();
    } finally {
      await mock.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("env token preempts proactive refresh", async () => {
    const mock = await createMockServer();
    const dir = await mkdtemp(join(tmpdir(), "rd-refresh-"));
    try {
      const expiresAt = new Date(Date.now() + 1000).toISOString();
      await mkdir(dir, { recursive: true });
      await writeFile(
        join(dir, "credentials.json"),
        JSON.stringify({
          profiles: {
            default: {
              access_token: "stored",
              refresh_token: "rt",
              client_id: "cid",
              client_secret: "csecret",
              expires_at: expiresAt,
            },
          },
        }),
        { mode: 0o600 },
      );
      mock.addRoute({
        method: "GET",
        path: "/user",
        status: 200,
        body: { result: true, user: { _id: 1 } },
      });
      const result = await run(
        ["--base-url", mock.url, "user", "get"],
        {
          RAINDROP_ACCESS_TOKEN: "env-token",
          RAINDROP_TOKEN_URL: `${mock.url}/oauth/access_token`,
        },
        dir,
      );
      expect(result.code).toBe(0);
      const userRequest = mock.requests.find((r) => r.url === "/user");
      expect(userRequest!.headers["authorization"]).toBe("Bearer env-token");
      const refreshRequest = mock.requests.find(
        (r) => r.url === "/oauth/access_token",
      );
      expect(refreshRequest).toBeUndefined();
    } finally {
      await mock.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
