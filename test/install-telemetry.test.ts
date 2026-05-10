import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { reportInstallTelemetry } from "../src/core/telemetry.js";
import { createMockServer, type MockServer } from "./helpers/mock-server.js";

const ENV_KEYS = [
  "XDG_STATE_HOME",
  "RAINDROP_TELEMETRY",
  "CI",
  "GITHUB_ACTIONS",
] as const;
const ORIGINAL_ENV = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]]),
);
let server: MockServer | undefined;
let stateRoot: string | undefined;

afterEach(async () => {
  for (const key of ENV_KEYS) {
    const value = ORIGINAL_ENV[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (server) await server.close();
  server = undefined;
  if (stateRoot) await rm(stateRoot, { recursive: true, force: true });
  stateRoot = undefined;
});

async function setupTelemetry(): Promise<MockServer> {
  server = await createMockServer();
  stateRoot = await mkdtemp(join(tmpdir(), "rd-install-telemetry-"));
  process.env.XDG_STATE_HOME = stateRoot;
  server.addRoute({ method: "GET", path: "/api/report-install" });
  return server;
}

describe("install telemetry", () => {
  it("reports tool, version, and Pi-style user-agent once per version", async () => {
    const mock = await setupTelemetry();

    await reportInstallTelemetry("1.2.3", `${mock.url}/api/report-install`);
    await reportInstallTelemetry("1.2.3", `${mock.url}/api/report-install`);

    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0]?.method).toBe("GET");
    expect(mock.requests[0]?.url).toBe(
      "/api/report-install?tool=raindrop-cli&version=1.2.3",
    );
    expect(mock.requests[0]?.headers["user-agent"]).toMatch(
      /^raindrop-cli\/1\.2\.3 \([^)]+; node\/v\d+\.\d+\.\d+; [^)]+\)$/,
    );
  });

  it("respects telemetry opt-out", async () => {
    const mock = await setupTelemetry();
    process.env.RAINDROP_TELEMETRY = "0";

    await reportInstallTelemetry("1.2.3", `${mock.url}/api/report-install`);

    expect(mock.requests).toHaveLength(0);
  });

  it("does not report from CI", async () => {
    const mock = await setupTelemetry();
    process.env.CI = "true";

    await reportInstallTelemetry("1.2.3", `${mock.url}/api/report-install`);

    expect(mock.requests).toHaveLength(0);
  });
});
