#!/usr/bin/env node
/**
 * Spec lint: validate that every command in spec/commands.yaml
 * has at least one example and no banned vocabulary.
 * Run: pnpm tsx scripts/spec-lint.ts
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCommandsYaml } from "./lib/parse-commands-yaml.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const banned = ["info", "show", "ls", "rm"];
const bannedFlags = [
  "--per-page",
  "--page-size",
  "--skip-confirmations",
  "--yes-really",
  "--no-prompt",
  "--quiet-confirm",
];

const specText = readFileSync(join(root, "spec/commands.yaml"), "utf8");
const commands = parseCommandsYaml(specText);

let errors = 0;

for (const cmd of commands) {
  // Check examples
  if (cmd.examples.length === 0) {
    console.error(`FAIL: ${cmd.name} has no examples`);
    errors++;
  }

  // Check banned command names
  for (const b of banned) {
    if (cmd.name.includes(`.${b}`) || cmd.name === b) {
      console.error(`FAIL: ${cmd.name} uses banned name "${b}"`);
      errors++;
    }
  }

  // Check banned flags in examples
  for (const ex of cmd.examples) {
    for (const bf of bannedFlags) {
      if (ex.includes(bf)) {
        console.error(
          `FAIL: ${cmd.name} example uses banned flag "${bf}": ${ex}`,
        );
        errors++;
      }
    }
  }
}

if (errors > 0) {
  console.error(`\n${errors} error(s) found`);
  process.exit(1);
} else {
  console.log(`OK: ${commands.length} commands validated`);
}
