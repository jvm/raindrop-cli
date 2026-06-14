import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

export type CliRunResult = {
  code: number;
  stdout: string;
  stderr: string;
};

export type RunCliOptions = {
  env?: Record<string, string>;
  configDir?: string;
  /** Override the mkdtemp prefix; useful for visible-by-test diagnostics. */
  tmpPrefix?: string;
};

/**
 * Build a clean env for spawning the CLI. We strip every `RAINDROP_*`
 * variable that might be set ambient in the test process (e.g. a
 * developer running tests with `RAINDROP_ACCESS_TOKEN` exported in
 * their shell) so test outcomes are independent of the caller's
 * environment. Callers can still set a value through `options.env` —
 * it just has to be set explicitly per test.
 */
function cleanChildEnv(
  configDir: string,
  overrides: Record<string, string> = {},
): NodeJS.ProcessEnv {
  const inherited: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!k.startsWith("RAINDROP_") && v !== undefined) inherited[k] = v;
  }
  return { ...inherited, RAINDROP_CONFIG_DIR: configDir, ...overrides };
}

/**
 * Spawn the local CLI with a fresh (or caller-provided) config dir.
 * Returns a normalized { code, stdout, stderr } shape that never throws.
 *
 * Uses the prebuilt dist/cli.js (set up by `test/global-setup.ts`'s
 * globalSetup) rather than `pnpm tsx src/cli.ts` so tests are
 * deterministic and fast — the cold-start cost of resolving `pnpm`,
 * loading tsx, and transpiling TypeScript varied under parallel test
 * load and pushed tests over the 10s default timeout. The
 * `globalSetup` builds `dist/` once, then every `runCli` is
 * `node dist/cli.js` which is sub-100ms per invocation.
 */
export async function runCli(args: string[], options: RunCliOptions = {}): Promise<CliRunResult> {
  const dir =
    options.configDir ?? (await mkdtemp(join(tmpdir(), options.tmpPrefix ?? "raindrop-cli-")));
  try {
    return await exec("node", ["dist/cli.js", ...args], {
      env: cleanChildEnv(dir, options.env),
    }).then(
      (r) => ({ code: 0, stdout: r.stdout, stderr: r.stderr }),
      (e: unknown) => {
        const err = e as { code?: number; stdout?: string; stderr?: string };
        return {
          code: err.code ?? 1,
          stdout: err.stdout ?? "",
          stderr: err.stderr ?? "",
        };
      },
    );
  } finally {
    if (!options.configDir) await rm(dir, { recursive: true, force: true });
  }
}
