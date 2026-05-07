import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { commandSpecs } from "../src/generated/command-specs.js";

const runProcess = promisify(execFile);

async function run(
  args: string[],
  env: Record<string, string> = {},
  configDir?: string,
) {
  const dir = configDir ?? (await mkdtemp(join(tmpdir(), "rd-agentctx-")));
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

describe("agent-context coverage", () => {
  it("includes every enum used by validators", async () => {
    const result = await run(["agent-context"]);
    expect(result.code).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.valid_values.bookmark_sort).toBeDefined();
    expect(parsed.valid_values.collection_view).toBeDefined();
    expect(parsed.valid_values.export_format).toBeDefined();
    expect(parsed.valid_values.backup_format).toBeDefined();
    expect(parsed.valid_values.highlight_color).toBeDefined();
    expect(parsed.valid_values.sharing_role).toBeDefined();
    expect(parsed.valid_values.delivery_sink).toContain("stdout");
    expect(parsed.valid_values.delivery_sink).toContain("file:<path>");
    expect(parsed.valid_values.delivery_sink).toContain("webhook:<url>");
    expect(parsed.valid_values.system_collections["0"]).toBeDefined();
    expect(parsed.valid_values.system_collections["-1"]).toBeDefined();
    expect(parsed.valid_values.system_collections["-99"]).toBeDefined();
  });

  it("lists global flags including --config and schema flags", async () => {
    const result = await run(["agent-context"]);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.global_flags).toEqual(
      expect.arrayContaining([
        "--json",
        "--human",
        "--debug",
        "--no-color",
        "--config",
        "--profile",
        "--base-url",
        "--request-schema",
        "--response-schema",
      ]),
    );
  });

  it("commands are sourced from generated specs (every spec entry present)", async () => {
    const result = await run(["agent-context"]);
    const parsed = JSON.parse(result.stdout);
    for (const spec of commandSpecs) {
      expect(
        parsed.commands[spec.name],
        `Missing command ${spec.name} in agent-context`,
      ).toBeDefined();
      expect(parsed.commands[spec.name].summary).toBe(spec.summary);
      expect(parsed.commands[spec.name].examples.length).toBeGreaterThan(0);
    }
  });
});
