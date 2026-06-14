export interface CommandSpec {
  name: string;
  summary: string;
  examples: string[];
  flags?: Record<string, { description: string; type?: string; enum?: string[] }>;
}

/**
 * Parse the trimmed `commands:` block of spec/commands.yaml.
 * Expects a flat indentation convention (no real YAML structure):
 *   "  name:"        → command name
 *   "    summary:"   → one-line summary
 *   "    examples:"  → followed by 6-space-indented "- …" lines
 */
export function parseCommandsYaml(text: string): CommandSpec[] {
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
