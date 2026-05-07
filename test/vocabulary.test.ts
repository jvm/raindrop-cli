import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const banned = [
  '.alias("ls")',
  '.alias("rm")',
  "--skip-confirmations",
  "--yes-really",
  "--per-page",
  "--page-size",
  "--format=json",
  "--output=json",
];

describe("vocabulary", () => {
  it("does not use banned CLI vocabulary", async () => {
    const source = await readFile("src/cli.ts", "utf8");
    for (const token of banned) expect(source).not.toContain(token);
  });
});
