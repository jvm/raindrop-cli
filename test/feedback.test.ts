import { mkdir, rm, readFile } from "node:fs/promises";
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
  const dir = configDir ?? (await mkdtemp(join(tmpdir(), "rd-fb-")));
  try {
    // Feedback uses state dir, not config dir, so we need to also set RAINDROP_CONFIG_DIR
    // to isolate the state dir. The paths module uses XDG_STATE_HOME for state.
    return await exec("pnpm", ["tsx", "src/cli.ts", ...args], {
      env: {
        ...process.env,
        RAINDROP_CONFIG_DIR: dir,
        XDG_STATE_HOME: join(dir, "state"),
        ...env,
      },
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

describe("feedback", () => {
  it("records a feedback entry", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rd-fb-"));
    try {
      const result = await run(["feedback", "test issue report"], {}, dir);
      expect(result.code).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.result).toBe(true);
      expect(parsed.entry.message).toBe("test issue report");
      expect(parsed.entry.ts).toBeDefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("lists feedback entries", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rd-fb-"));
    try {
      await run(["feedback", "first feedback"], {}, dir);
      await run(["feedback", "second feedback"], {}, dir);

      const result = await run(["feedback", "list"], {}, dir);
      expect(result.code).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.items).toHaveLength(2);
      expect(parsed.items[0].message).toBe("first feedback");
      expect(parsed.items[1].message).toBe("second feedback");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("clears feedback with --force", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rd-fb-"));
    try {
      await run(["feedback", "to be cleared"], {}, dir);

      const result = await run(["feedback", "clear", "--force"], {}, dir);
      expect(result.code).toBe(0);

      // Verify empty
      const listResult = await run(["feedback", "list"], {}, dir);
      const parsed = JSON.parse(listResult.stdout);
      expect(parsed.items).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("feedback clear requires --force", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rd-fb-"));
    try {
      await mkdir(join(dir, "state", "raindrop"), { recursive: true });
      const result = await run(["feedback", "clear"], {}, dir);
      expect(result.code).toBe(2);
      const err = JSON.parse(result.stderr);
      expect(err.error.code).toBe("force_required");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("persists feedback to JSONL file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rd-fb-"));
    try {
      await run(["feedback", "jsonl test"], {}, dir);

      const fbPath = join(dir, "state", "raindrop", "feedback.jsonl");
      const content = await readFile(fbPath, "utf8");
      const entry = JSON.parse(content.trim());
      expect(entry.message).toBe("jsonl test");
      expect(entry.ts).toBeDefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
