import { mkdir, rm, readFile, writeFile, stat } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "./helpers/run-cli.js";

describe("credentials permissions", () => {
  it("stores credentials with 0600 permissions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rd-cred-"));
    try {
      const result = await runCli(["auth", "login", "--token", "my-secret-token"], {
        configDir: dir,
      });
      expect(result.code).toBe(0);

      // Verify file permissions
      if (process.platform !== "win32") {
        const s = await stat(join(dir, "credentials.json"));
        const mode = s.mode & 0o777;
        expect(mode).toBe(0o600);
      }

      // Verify credentials are stored
      const content = JSON.parse(await readFile(join(dir, "credentials.json"), "utf8"));
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

      const result = await runCli(["auth", "status"], { configDir: dir });
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
      const result = await runCli(["--profile", "work", "auth", "login", "--token", "work-token"], {
        configDir: dir,
      });
      expect(result.code).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.profile).toBe("work");

      const content = JSON.parse(await readFile(join(dir, "credentials.json"), "utf8"));
      expect(content.profiles.work.access_token).toBe("work-token");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("logout removes profile credentials", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rd-cred-"));
    try {
      // Login
      await runCli(["auth", "login", "--token", "tok", "--force"], {
        configDir: dir,
      });
      // Logout
      const result = await runCli(["auth", "logout", "--force"], {
        configDir: dir,
      });
      expect(result.code).toBe(0);

      const content = JSON.parse(await readFile(join(dir, "credentials.json"), "utf8"));
      expect(content.profiles.default).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
