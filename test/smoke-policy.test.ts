import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("live smoke policy", () => {
  it("does not permanently empty Trash", async () => {
    const text = await readFile("test/smoke/live-smoke.ts", "utf8");
    expect(text).not.toContain("/collection/-99");
    expect(text).not.toContain("empty-trash");
  });
});
