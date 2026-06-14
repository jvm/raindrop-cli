import { describe, expect, it } from "vitest";
import { runCli } from "./helpers/run-cli.js";

describe("tag rename validation", () => {
  it("rejects identical old and new names", async () => {
    const result = await runCli(["tag", "rename", "same", "same", "--collection", "0"], {
      env: { RAINDROP_ACCESS_TOKEN: "tok" },
    });
    expect(result.code).toBe(2);
    const err = JSON.parse(result.stderr);
    expect(err.error.code).toBe("tag_rename_identical");
  });

  it("rejects empty tag name", async () => {
    const result = await runCli(["tag", "rename", "", "new", "--collection", "0"], {
      env: { RAINDROP_ACCESS_TOKEN: "tok" },
    });
    expect(result.code).toBe(2);
    const err = JSON.parse(result.stderr);
    expect(err.error.code).toBe("invalid_tag");
  });

  it("rejects whitespace-only tag name", async () => {
    const result = await runCli(["tag", "rename", "   ", "new", "--collection", "0"], {
      env: { RAINDROP_ACCESS_TOKEN: "tok" },
    });
    expect(result.code).toBe(2);
    const err = JSON.parse(result.stderr);
    expect(err.error.code).toBe("invalid_tag");
  });

  it("merge rejects target appearing in old set", async () => {
    const result = await runCli(
      ["tag", "merge", "common", "alpha", "common", "--collection", "0"],
      { env: { RAINDROP_ACCESS_TOKEN: "tok" } },
    );
    expect(result.code).toBe(2);
    const err = JSON.parse(result.stderr);
    expect(err.error.code).toBe("tag_merge_includes_target");
  });
});
