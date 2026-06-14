import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "./helpers/run-cli.js";
import { createMockServer } from "./helpers/mock-server.js";

describe("import commands", () => {
  it("import exists treats result:false as data with exit 0", async () => {
    const mock = await createMockServer();
    const dir = await mkdtemp(join(tmpdir(), "rd-import-"));
    try {
      // URL does not exist — API returns result:false
      mock.addRoute({
        method: "POST",
        path: "/import/url/exists",
        status: 200,
        body: { result: false },
      });

      const result = await runCli(
        ["--base-url", `${mock.url}`, "import", "exists", "https://new.example.com"],
        { env: { RAINDROP_ACCESS_TOKEN: "test-token" }, configDir: dir },
      );
      expect(result.code).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.result).toBe(true); // Our wrapper forces result:true
    } finally {
      await mock.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("import exists returns match data when URL exists", async () => {
    const mock = await createMockServer();
    const dir = await mkdtemp(join(tmpdir(), "rd-import-"));
    try {
      mock.addRoute({
        method: "POST",
        path: "/import/url/exists",
        status: 200,
        body: {
          result: true,
          item: { _id: 42, link: "https://found.example.com" },
        },
      });

      const result = await runCli(
        ["--base-url", `${mock.url}`, "import", "exists", "https://found.example.com"],
        { env: { RAINDROP_ACCESS_TOKEN: "test-token" }, configDir: dir },
      );
      expect(result.code).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.result).toBe(true);
    } finally {
      await mock.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
