import { describe, expect, it } from "vitest";
import { buildProgram } from "../src/cli.js";

describe("banned vocabulary", () => {
  it("does not use banned command names", () => {
    const banned = ["info", "show", "ls", "rm"];
    const program = buildProgram();

    function walk(cmd: any, path: string): string[] {
      const names: string[] = [];
      const name = cmd.name();
      const fullPath = path ? `${path} ${name}` : name;
      if (banned.includes(name)) names.push(fullPath);
      for (const sub of cmd.commands ?? []) {
        names.push(...walk(sub, fullPath));
      }
      return names;
    }

    const violations = walk(program, "");
    expect(violations).toEqual([]);
  });

  it("does not use banned flag names", () => {
    const bannedFlags = [
      "--per-page",
      "--page-size",
      "--format=json",
      "--skip-confirmations",
      "--yes-really",
      "--no-prompt",
      "--quiet-confirm",
    ];
    const program = buildProgram();

    function walk(cmd: any, path: string): string[] {
      const violations: string[] = [];
      const name = cmd.name();
      const fullPath = path ? `${path} ${name}` : name;
      for (const opt of cmd.options ?? []) {
        const flags = [opt.short, opt.long].filter(Boolean);
        for (const flag of flags) {
          if (bannedFlags.includes(flag)) {
            violations.push(`${fullPath} uses banned flag: ${flag}`);
          }
        }
      }
      for (const sub of cmd.commands ?? []) {
        violations.push(...walk(sub, fullPath));
      }
      return violations;
    }

    const violations = walk(program, "");
    expect(violations).toEqual([]);
  });

  it("every command group has a description", () => {
    const program = buildProgram();

    function walk(cmd: any, path: string): string[] {
      const missing: string[] = [];
      const name = cmd.name();
      const fullPath = path ? `${path} ${name}` : name;
      // Only check command groups (those with subcommands), not leaf actions
      if (
        name !== "help" &&
        name !== "*" &&
        (cmd.commands?.length ?? 0) > 0 &&
        !cmd.description()
      ) {
        missing.push(fullPath);
      }
      for (const sub of cmd.commands ?? []) {
        missing.push(...walk(sub, fullPath));
      }
      return missing;
    }

    const missing = walk(program, "");
    expect(missing).toEqual([]);
  });
});
