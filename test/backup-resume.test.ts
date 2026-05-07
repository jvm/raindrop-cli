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
  const dir = configDir ?? (await mkdtemp(join(tmpdir(), "rd-bres-")));
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

describe("backup generate jobs ledger resume", () => {
  it("baseline backup id is captured before generate", async () => {
    const mock = await createMockServer();
    const dir = await mkdtemp(join(tmpdir(), "rd-bres-"));
    try {
      mock.addRoute({
        method: "GET",
        path: "/backups",
        status: 200,
        body: { result: true, items: [{ _id: 1 }] },
        once: true,
      });
      mock.addRoute({
        method: "GET",
        path: "/backup",
        status: 200,
        body: { result: true },
      });
      const result = await run(
        ["--base-url", mock.url, "backup", "generate"],
        { RAINDROP_ACCESS_TOKEN: "tok" },
        dir,
      );
      expect(result.code).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.job_id).toMatch(/^backup-\d+$/);
    } finally {
      await mock.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("--resume reuses the most recent in-progress job id", async () => {
    const mock = await createMockServer();
    const dir = await mkdtemp(join(tmpdir(), "rd-bres-"));
    try {
      // Pre-seed an in-progress backup job recently
      const stateDir = join(dir, "state", "raindrop");
      await mkdir(stateDir, { recursive: true });
      await writeFile(
        join(stateDir, "jobs.jsonl"),
        JSON.stringify({
          id: "backup-prior",
          kind: "backup.generate",
          status: "started",
          started_at: new Date().toISOString(),
          baseline_id: 5,
        }) + "\n",
        "utf8",
      );
      // Polling /backups returns a newer id (10) than baseline (5)
      mock.addRoute({
        method: "GET",
        path: "/backups",
        status: 200,
        body: { result: true, items: [{ _id: 10 }] },
      });
      const result = await run(
        [
          "--base-url",
          mock.url,
          "backup",
          "generate",
          "--wait",
          "--resume",
          "--poll-interval",
          "100ms",
          "--timeout",
          "5s",
        ],
        {
          RAINDROP_ACCESS_TOKEN: "tok",
          XDG_STATE_HOME: join(dir, "state"),
        },
        dir,
      );
      expect(result.code).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.job_id).toBe("backup-prior");
      expect(parsed.backup_id).toBe(10);
      // /backup should NOT have been called when resuming (no fresh trigger)
      const triggerCount = mock.requests.filter(
        (r) => r.method === "GET" && r.url === "/backup",
      ).length;
      expect(triggerCount).toBe(0);
    } finally {
      await mock.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
