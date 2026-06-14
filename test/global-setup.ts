// Vitest globalSetup — runs once, before any test files. We build the
// CLI bundle so integration tests can invoke `node dist/cli.js`
// directly. Without this, tests using `runCli` would shell out to
// `pnpm tsx src/cli.ts` which costs ~2s per spawn (pnpm resolve +
// tsx load + TypeScript transpile) and makes multi-spawn tests like
// `feedback.test.ts > clears feedback with --force` (3 sequential
// spawns) flaky under parallel load.
import { execFileSync } from "node:child_process";

export async function setup() {
  execFileSync("pnpm", ["build"], { stdio: "inherit" });
}
