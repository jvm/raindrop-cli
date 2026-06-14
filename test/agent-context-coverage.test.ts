import { describe, expect, it } from "vitest";
import { runCli } from "./helpers/run-cli.js";
import { commandSpecs } from "../src/generated/command-specs.js";

describe("agent-context coverage", () => {
  it("includes every enum used by validators", async () => {
    const result = await runCli(["agent-context"]);
    expect(result.code).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.valid_values.bookmark_sort).toBeDefined();
    expect(parsed.valid_values.collection_view).toBeDefined();
    expect(parsed.valid_values.export_format).toBeDefined();
    expect(parsed.valid_values.backup_format).toBeDefined();
    expect(parsed.valid_values.highlight_color).toBeDefined();
    expect(parsed.valid_values.sharing_role).toBeDefined();
    expect(parsed.valid_values.delivery_sink).toContain("stdout");
    expect(parsed.valid_values.delivery_sink).toContain("file:<path>");
    expect(parsed.valid_values.delivery_sink).toContain("webhook:<url>");
    expect(parsed.valid_values.system_collections["0"]).toBeDefined();
    expect(parsed.valid_values.system_collections["-1"]).toBeDefined();
    expect(parsed.valid_values.system_collections["-99"]).toBeDefined();
  });

  it("lists global flags including --config and schema flags", async () => {
    const result = await runCli(["agent-context"]);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.global_flags).toEqual(
      expect.arrayContaining([
        "--json",
        "--human",
        "--debug",
        "--no-color",
        "--config",
        "--profile",
        "--base-url",
        "--request-schema",
        "--response-schema",
      ]),
    );
  });

  it("commands are sourced from generated specs (every spec entry present)", async () => {
    const result = await runCli(["agent-context"]);
    const parsed = JSON.parse(result.stdout);
    for (const spec of commandSpecs) {
      expect(
        parsed.commands[spec.name],
        `Missing command ${spec.name} in agent-context`,
      ).toBeDefined();
      expect(parsed.commands[spec.name].summary).toBe(spec.summary);
      expect(parsed.commands[spec.name].examples.length).toBeGreaterThan(0);
    }
  });
});
