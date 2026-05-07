import { mkdir, rm, readFile, writeFile, stat } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

async function run(
  args: string[],
  env: Record<string, string> = {},
  configDir?: string,
) {
  const dir = configDir ?? (await mkdtemp(join(tmpdir(), "rd-cred-")));
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

describe("credentials permissions", () => {
  it("stores credentials with 0600 permissions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rd-cred-"));
    try {
      const result = await run(
        ["auth", "login", "--token", "my-secret-token"],
        {},
        dir,
      );
      expect(result.code).toBe(0);

      // Verify file permissions
      if (process.platform !== "win32") {
        const s = await stat(join(dir, "credentials.json"));
        const mode = s.mode & 0o777;
        expect(mode).toBe(0o600);
      }

      // Verify credentials are stored
      const content = JSON.parse(
        await readFile(join(dir, "credentials.json"), "utf8"),
      );
      expect(content.profiles.default.access_token).toBe("my-secret-token");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("refuses to use group/world-readable credentials", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rd-cred-"));
    try {
      await mkdir(dir, { recursive: true });
      await writeFile(
        join(dir, "credentials.json"),
        JSON.stringify({
          profiles: { default: { access_token: "tok", token_type: "Bearer" } },
        }),
        "utf8",
      );
      // Make it world-readable
      if (process.platform !== "win32") {
        const { chmod } = await import("node:fs/promises");
        await chmod(join(dir, "credentials.json"), 0o644);
      }

      const result = await run(["auth", "status"], {}, dir);
      if (process.platform !== "win32") {
        expect(result.code).not.toBe(0);
        const err = JSON.parse(result.stderr);
        expect(err.error.code).toBe("credentials_insecure_permissions");
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("stores token in named profile", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rd-cred-"));
    try {
      const result = await run(
        ["--profile", "work", "auth", "login", "--token", "work-token"],
        {},
        dir,
      );
      expect(result.code).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.profile).toBe("work");

      const content = JSON.parse(
        await readFile(join(dir, "credentials.json"), "utf8"),
      );
      expect(content.profiles.work.access_token).toBe("work-token");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("logout removes profile credentials", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rd-cred-"));
    try {
      // Login
      await run(["auth", "login", "--token", "tok", "--force"], {}, dir);
      // Logout
      const result = await run(["auth", "logout", "--force"], {}, dir);
      expect(result.code).toBe(0);

      const content = JSON.parse(
        await readFile(join(dir, "credentials.json"), "utf8"),
      );
      expect(content.profiles.default).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
