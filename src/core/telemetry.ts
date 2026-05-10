import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { stateDir } from "./paths.js";

const TOOL_NAME = "raindrop-cli";
const REPORT_INSTALL_URL = "https://mocito.dev/api/report-install";
const REPORT_INSTALL_TIMEOUT_MS = 5000;

type InstallTelemetryState = {
  lastReportedVersion?: string;
};

function isTruthyEnvFlag(value: string | undefined): boolean {
  if (!value) return false;
  return (
    value === "1" ||
    value.toLowerCase() === "true" ||
    value.toLowerCase() === "yes"
  );
}

function isInstallTelemetryEnabled(hasExplicitEndpoint = false): boolean {
  if (process.env.VITEST && !hasExplicitEndpoint) return false;
  if (process.env.RAINDROP_TELEMETRY !== undefined) {
    return isTruthyEnvFlag(process.env.RAINDROP_TELEMETRY);
  }
  return true;
}

function installTelemetryStatePath(): string {
  return join(stateDir(), "install-telemetry.json");
}

async function readInstallTelemetryState(
  path: string,
): Promise<InstallTelemetryState> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as InstallTelemetryState;
  } catch {
    return {};
  }
}

function installTelemetryUserAgent(version: string): string {
  const runtimeVersions = process.versions as NodeJS.ProcessVersions & {
    bun?: string;
  };
  const runtime = runtimeVersions.bun
    ? `bun/${runtimeVersions.bun}`
    : `node/${process.version}`;
  return `${TOOL_NAME}/${version} (${process.platform}; ${runtime}; ${process.arch})`;
}

export async function reportInstallTelemetry(
  version: string,
  endpoint = REPORT_INSTALL_URL,
): Promise<void> {
  try {
    if (!isInstallTelemetryEnabled(endpoint !== REPORT_INSTALL_URL)) return;
    if (!version) return;

    const statePath = installTelemetryStatePath();
    const state = await readInstallTelemetryState(statePath);
    if (state.lastReportedVersion === version) return;

    await mkdir(dirname(statePath), { recursive: true });
    await writeFile(
      statePath,
      `${JSON.stringify({ lastReportedVersion: version }, null, 2)}\n`,
      "utf8",
    );

    const params = new URLSearchParams({ tool: TOOL_NAME, version });
    await fetch(`${endpoint}?${params.toString()}`, {
      headers: { "User-Agent": installTelemetryUserAgent(version) },
      signal: AbortSignal.timeout(REPORT_INSTALL_TIMEOUT_MS),
    });
  } catch {
    // Best-effort install/update telemetry: ignore filesystem and network failures.
  }
}
