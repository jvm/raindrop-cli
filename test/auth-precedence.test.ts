import { mkdir, rm, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "./helpers/run-cli.js";
import { createMockServer } from "./helpers/mock-server.js";

async function tmpConfigDir() {
  return mkdtemp(join(tmpdir(), "rd-auth-test-"));
}

describe("auth precedence", () => {
  it("env token is used over stored credentials", async () => {
    const mock = await createMockServer();
    const dir = await tmpConfigDir();
    try {
      // Store a credential in the profile
      const credsDir = join(dir);
      await mkdir(credsDir, { recursive: true });
      await writeFile(
        join(credsDir, "credentials.json"),
        JSON.stringify({
          profiles: {
            default: { access_token: "stored-token", token_type: "Bearer" },
          },
        }),
        { mode: 0o600 },
      );

      // But env var should take precedence — the server will verify which token was sent
      mock.addRoute({
        method: "GET",
        path: "/user",
        status: 200,
        body: { result: true, user: { _id: 1, email: "test@example.com" } },
      });

      const result = await runCli(["--base-url", `${mock.url}`, "user", "get"], {
        env: { RAINDROP_ACCESS_TOKEN: "env-token" },
        configDir: dir,
      });
      expect(result.code).toBe(0);
      // Verify the env token was sent, not the stored one
      expect(mock.requests[0]!.headers["authorization"]).toBe("Bearer env-token");
    } finally {
      await mock.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("stored credentials are used when env token is absent", async () => {
    const mock = await createMockServer();
    const dir = await tmpConfigDir();
    try {
      await mkdir(dir, { recursive: true });
      await writeFile(
        join(dir, "credentials.json"),
        JSON.stringify({
          profiles: {
            default: { access_token: "stored-token", token_type: "Bearer" },
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

      const result = await runCli(["--base-url", `${mock.url}`, "user", "get"], { configDir: dir });
      expect(result.code).toBe(0);
      expect(mock.requests[0]!.headers["authorization"]).toBe("Bearer stored-token");
    } finally {
      await mock.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("profile credentials are used when env token is absent and default profile exists", async () => {
    const mock = await createMockServer();
    const dir = await tmpConfigDir();
    try {
      await mkdir(dir, { recursive: true });
      await writeFile(
        join(dir, "credentials.json"),
        JSON.stringify({
          profiles: {
            default: { access_token: "default-token", token_type: "Bearer" },
            work: { access_token: "work-token", token_type: "Bearer" },
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

      const result = await runCli(
        ["--base-url", `${mock.url}`, "--profile", "work", "user", "get"],
        { configDir: dir },
      );
      expect(result.code).toBe(0);
      expect(mock.requests[0]!.headers["authorization"]).toBe("Bearer work-token");
    } finally {
      await mock.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("auth status shows source=env when env token is present", async () => {
    const dir = await tmpConfigDir();
    try {
      const result = await runCli(["auth", "status"], {
        env: { RAINDROP_ACCESS_TOKEN: "env-token" },
        configDir: dir,
      });
      expect(result.code).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.source).toBe("env");
      expect(parsed.authenticated).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("auth status returns error when no token is configured", async () => {
    const dir = await tmpConfigDir();
    try {
      const result = await runCli(["auth", "status"], { configDir: dir });
      expect(result.code).toBe(3);
      const err = JSON.parse(result.stderr);
      expect(err.error.code).toBe("auth_missing");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("auto-refreshes on 401 when refresh token exists", async () => {
    const mock = await createMockServer();
    const dir = await tmpConfigDir();
    try {
      await mkdir(dir, { recursive: true });

      // First request returns 401, triggering refresh
      mock.addRoute({
        method: "GET",
        path: "/user",
        status: 401,
        body: { result: false, errorMessage: "Unauthorized" },
        once: true,
      });

      // Token refresh endpoint
      mock.addRoute({
        method: "POST",
        path: "/oauth",
        status: 200,
        body: {
          access_token: "refreshed-token",
          token_type: "Bearer",
          expires_in: 1209600,
        },
      });

      // Write credentials with refresh capability
      await writeFile(
        join(dir, "credentials.json"),
        JSON.stringify({
          profiles: {
            default: {
              access_token: "expired-token",
              refresh_token: "refresh-tok",
              client_id: "cid",
              client_secret: "csec",
              token_type: "Bearer",
            },
          },
        }),
        { mode: 0o600 },
      );

      // The second attempt (after refresh) should also hit /user
      mock.addRoute({
        method: "GET",
        path: "/user",
        status: 200,
        body: {
          result: true,
          user: { _id: 42, email: "refreshed@example.com" },
        },
      });

      const result = await runCli(["--base-url", `${mock.url}`, "user", "get"], {
        env: { RAINDROP_TOKEN_URL: `${mock.url}/oauth` },
        configDir: dir,
      });

      // Should have succeeded after refresh
      expect(result.code).toBe(0);
      // Verify refresh was called
      const refreshReq = mock.requests.find((r) => r.url === "/oauth");
      expect(refreshReq).toBeDefined();
      expect((refreshReq!.body as any)?.grant_type).toBe("refresh_token");
    } finally {
      await mock.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
