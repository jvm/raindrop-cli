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
  const dir = configDir ?? (await mkdtemp(join(tmpdir(), "rd-redact-")));
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

describe("debug redaction across command paths", () => {
  it("does not echo Authorization header in --debug output", async () => {
    const mock = await createMockServer();
    const dir = await mkdtemp(join(tmpdir(), "rd-redact-"));
    try {
      mock.addRoute({
        method: "GET",
        path: "/user",
        status: 200,
        body: { result: true, user: { _id: 1, email: "x@y" } },
      });
      const result = await run(
        ["--base-url", mock.url, "--debug", "user", "get"],
        { RAINDROP_ACCESS_TOKEN: "super-secret-token" },
        dir,
      );
      expect(result.code).toBe(0);
      expect(result.stderr).not.toContain("super-secret-token");
      expect(result.stderr.toLowerCase()).not.toContain("authorization");
    } finally {
      await mock.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("redacts secret-bearing fields in API error details", async () => {
    const mock = await createMockServer();
    const dir = await mkdtemp(join(tmpdir(), "rd-redact-"));
    try {
      mock.addRoute({
        method: "POST",
        path: "/raindrop",
        status: 400,
        body: {
          result: false,
          errorMessage: "bad request",
          access_token: "leaked-from-server",
          client_secret: "leaked-too",
          nested: { authorization: "Bearer xxx" },
        },
      });
      const result = await run(
        [
          "--base-url",
          mock.url,
          "bookmark",
          "create",
          "-d",
          JSON.stringify({ link: "https://x.example" }),
        ],
        { RAINDROP_ACCESS_TOKEN: "tok" },
        dir,
      );
      expect(result.code).not.toBe(0);
      expect(result.stderr).not.toContain("leaked-from-server");
      expect(result.stderr).not.toContain("leaked-too");
      expect(result.stderr).not.toContain("Bearer xxx");
      const err = JSON.parse(result.stderr);
      expect(err.error.details.access_token).toBe("[redacted]");
      expect(err.error.details.client_secret).toBe("[redacted]");
      expect(err.error.details.nested.authorization).toBe("[redacted]");
    } finally {
      await mock.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("auth status hides access token even in --debug", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rd-redact-"));
    try {
      await mkdir(dir, { recursive: true });
      await writeFile(
        join(dir, "credentials.json"),
        JSON.stringify({
          profiles: {
            default: {
              access_token: "stored-secret-12345",
              refresh_token: "refresh-secret-67890",
              client_secret: "cs-secret",
              token_type: "Bearer",
            },
          },
        }),
        { mode: 0o600 },
      );
      const result = await run(["--debug", "auth", "status"], {}, dir);
      expect(result.code).toBe(0);
      expect(result.stdout).not.toContain("stored-secret-12345");
      expect(result.stdout).not.toContain("refresh-secret-67890");
      expect(result.stdout).not.toContain("cs-secret");
      expect(result.stderr).not.toContain("stored-secret-12345");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("config list never prints credentials.json values", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rd-redact-"));
    try {
      await mkdir(dir, { recursive: true });
      await writeFile(
        join(dir, "credentials.json"),
        JSON.stringify({
          profiles: {
            default: {
              access_token: "config-list-leak",
              client_secret: "config-list-secret",
            },
          },
        }),
        { mode: 0o600 },
      );
      const result = await run(["config", "list"], {}, dir);
      expect(result.stdout).not.toContain("config-list-leak");
      expect(result.stdout).not.toContain("config-list-secret");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("agent-context never includes any credential token", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rd-redact-"));
    try {
      await mkdir(dir, { recursive: true });
      await writeFile(
        join(dir, "credentials.json"),
        JSON.stringify({
          profiles: {
            default: { access_token: "agent-context-leak-test" },
            work: { access_token: "another-leak" },
          },
        }),
        { mode: 0o600 },
      );
      await writeFile(
        join(dir, "profiles.json"),
        JSON.stringify({
          profiles: {
            default: { default_collection: 0 },
            work: { default_collection: 1 },
          },
        }),
        "utf8",
      );
      const result = await run(["agent-context"], {}, dir);
      expect(result.code).toBe(0);
      expect(result.stdout).not.toContain("agent-context-leak-test");
      expect(result.stdout).not.toContain("another-leak");
      const parsed = JSON.parse(result.stdout);
      expect(parsed.available_profiles.sort()).toEqual(["default", "work"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("bookmark create with secret-like body field still redacts in error response", async () => {
    const mock = await createMockServer();
    const dir = await mkdtemp(join(tmpdir(), "rd-redact-"));
    try {
      mock.addRoute({
        method: "POST",
        path: "/raindrop",
        status: 500,
        body: {
          result: false,
          message: "server failure",
          authorization: "Bearer leaked",
          token: "leaked-token-payload",
        },
      });
      const result = await run(
        [
          "--base-url",
          mock.url,
          "--debug",
          "bookmark",
          "create",
          "-d",
          JSON.stringify({ link: "https://x.example" }),
        ],
        { RAINDROP_ACCESS_TOKEN: "tok" },
        dir,
      );
      expect(result.code).not.toBe(0);
      expect(result.stderr).not.toContain("leaked-token-payload");
      expect(result.stderr).not.toContain("Bearer leaked");
    } finally {
      await mock.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
