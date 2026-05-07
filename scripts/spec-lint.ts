#!/usr/bin/env node
/**
 * Spec lint: validate that every command in spec/commands.yaml
 * has at least one example and no banned vocabulary.
 * Run: pnpm tsx scripts/spec-lint.ts
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

interface CommandSpec {
  name: string;
  summary: string;
  examples: string[];
}

function parseCommandsYaml(text: string): CommandSpec[] {
  const commands: CommandSpec[] = [];
  let current: CommandSpec | null = null;
  let inExamples = false;

  for (const line of text.split("\n")) {
    const trimmed = line.trimEnd();
    if (trimmed === "" || trimmed.startsWith("#")) continue;

    const cmdMatch = trimmed.match(/^ {2}([a-z._-]+):$/);
    if (cmdMatch && cmdMatch[1]) {
      if (current) commands.push(current);
      current = { name: cmdMatch[1], summary: "", examples: [] };
      inExamples = false;
      continue;
    }

    if (!current) continue;

    const summaryMatch = trimmed.match(/^ {4}summary:\s*"?(.+?)"?\s*$/);
    if (summaryMatch && summaryMatch[1]) {
      current.summary = summaryMatch[1];
      inExamples = false;
      continue;
    }

    if (trimmed === "    examples:") {
      inExamples = true;
      continue;
    }

    if (inExamples) {
      const exMatch = trimmed.match(/^ {6}- (.+)$/);
      if (exMatch && exMatch[1]) {
        current.examples.push(exMatch[1].trim());
        continue;
      }
      inExamples = false;
    }
  }
  if (current) commands.push(current);
  return commands;
}

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
