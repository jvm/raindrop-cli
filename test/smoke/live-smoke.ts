import { buildProgram } from "../../src/cli.js";

if (!process.env.RAINDROP_ACCESS_TOKEN) {
  console.error("Set RAINDROP_ACCESS_TOKEN to run live smoke tests.");
  process.exit(2);
}

await buildProgram().parseAsync(["node", "raindrop", "user", "get"]);
