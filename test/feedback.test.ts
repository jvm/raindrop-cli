import { mkdir, rm, readFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "./helpers/run-cli.js";

async function setupDir(): Promise<{ dir: string; stateHome: string }> {
  const dir = await mkdtemp(join(tmpdir(), "rd-fb-"));
  const stateHome = join(dir, "state");
  await mkdir(stateHome, { recursive: true });
  return { dir, stateHome };
}

async function cleanup(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

describe("feedback", () => {
  it("records a feedback entry", async () => {
    const { dir, stateHome } = await setupDir();
    try {
      const result = await runCli(["feedback", "test issue report"], {
        env: { XDG_STATE_HOME: stateHome },
        configDir: dir,
      });
      expect(result.code).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.result).toBe(true);
      expect(parsed.entry.message).toBe("test issue report");
      expect(parsed.entry.ts).toBeDefined();
    } finally {
      await cleanup(dir);
    }
  });

  it("lists feedback entries", async () => {
    const { dir, stateHome } = await setupDir();
    try {
      await runCli(["feedback", "first feedback"], {
        env: { XDG_STATE_HOME: stateHome },
        configDir: dir,
      });
      await runCli(["feedback", "second feedback"], {
        env: { XDG_STATE_HOME: stateHome },
        configDir: dir,
      });

      const result = await runCli(["feedback", "list"], {
        env: { XDG_STATE_HOME: stateHome },
        configDir: dir,
      });
      expect(result.code).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.items).toHaveLength(2);
      expect(parsed.items[0].message).toBe("first feedback");
      expect(parsed.items[1].message).toBe("second feedback");
    } finally {
      await cleanup(dir);
    }
  });

  it("clears feedback with --force", async () => {
    const { dir, stateHome } = await setupDir();
    try {
      await runCli(["feedback", "to be cleared"], {
        env: { XDG_STATE_HOME: stateHome },
        configDir: dir,
      });

      const result = await runCli(["feedback", "clear", "--force"], {
        env: { XDG_STATE_HOME: stateHome },
        configDir: dir,
      });
      expect(result.code).toBe(0);

      // Verify empty
      const listResult = await runCli(["feedback", "list"], {
        env: { XDG_STATE_HOME: stateHome },
        configDir: dir,
      });
      const parsed = JSON.parse(listResult.stdout);
      expect(parsed.items).toHaveLength(0);
    } finally {
      await cleanup(dir);
    }
  });

  it("feedback clear requires --force", async () => {
    const { dir, stateHome } = await setupDir();
    try {
      const result = await runCli(["feedback", "clear"], {
        env: { XDG_STATE_HOME: stateHome },
        configDir: dir,
      });
      expect(result.code).toBe(2);
      const err = JSON.parse(result.stderr);
      expect(err.error.code).toBe("force_required");
    } finally {
      await cleanup(dir);
    }
  });

  it("persists feedback to JSONL file", async () => {
    const { dir, stateHome } = await setupDir();
    try {
      await runCli(["feedback", "jsonl test"], {
        env: { XDG_STATE_HOME: stateHome },
        configDir: dir,
      });

      const fbPath = join(stateHome, "raindrop", "feedback.jsonl");
      const content = await readFile(fbPath, "utf8");
      const entry = JSON.parse(content.trim());
      expect(entry.message).toBe("jsonl test");
      expect(entry.ts).toBeDefined();
    } finally {
      await cleanup(dir);
    }
  });
});
