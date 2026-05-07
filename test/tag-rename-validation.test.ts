import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const runProcess = promisify(execFile);

async function run(
  args: string[],
  env: Record<string, string> = {},
  configDir?: string,
) {
  const dir = configDir ?? (await mkdtemp(join(tmpdir(), "rd-tagval-")));
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

describe("tag rename validation", () => {
  it("rejects identical old and new names", async () => {
    const result = await run(
      ["tag", "rename", "same", "same", "--collection", "0"],
      { RAINDROP_ACCESS_TOKEN: "tok" },
    );
    expect(result.code).toBe(2);
    const err = JSON.parse(result.stderr);
    expect(err.error.code).toBe("tag_rename_identical");
  });

  it("rejects empty tag name", async () => {
    const result = await run(
      ["tag", "rename", "", "new", "--collection", "0"],
      { RAINDROP_ACCESS_TOKEN: "tok" },
    );
    expect(result.code).toBe(2);
    const err = JSON.parse(result.stderr);
    expect(err.error.code).toBe("invalid_tag");
  });

  it("rejects whitespace-only tag name", async () => {
    const result = await run(
      ["tag", "rename", "   ", "new", "--collection", "0"],
      { RAINDROP_ACCESS_TOKEN: "tok" },
    );
    expect(result.code).toBe(2);
    const err = JSON.parse(result.stderr);
    expect(err.error.code).toBe("invalid_tag");
  });

  it("merge rejects target appearing in old set", async () => {
    const result = await run(
      ["tag", "merge", "common", "alpha", "common", "--collection", "0"],
      { RAINDROP_ACCESS_TOKEN: "tok" },
    );
    expect(result.code).toBe(2);
    const err = JSON.parse(result.stderr);
    expect(err.error.code).toBe("tag_merge_includes_target");
  });
});
