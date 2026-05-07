import { stat } from "node:fs/promises";
import { CLIError, ExitCode } from "./errors.js";

export const bookmarkSorts = [
  "-created",
  "created",
  "score",
  "-sort",
  "title",
  "-title",
  "domain",
  "-domain",
];
export const collectionViews = ["list", "simple", "grid", "masonry"];
export const exportFormats = ["csv", "html", "zip"];
export const backupFormats = ["csv", "html"];
export const sharingRoles = ["member", "viewer"];
export const highlightColors = [
  "blue",
  "brown",
  "cyan",
  "gray",
  "green",
  "indigo",
  "orange",
  "pink",
  "purple",
  "red",
  "teal",
  "yellow",
];

export function requireForce(force: boolean | undefined, what: string): void {
  if (!force) {
    throw new CLIError({
      code: "force_required",
      message: `${what} requires --force`,
      hint: `Re-run with --force after verifying the target scope`,
      exitCode: ExitCode.Usage,
    });
  }
}

export function intArg(value: string, name: string): number {
  const n = Number(value);
  if (!Number.isInteger(n))
    throw new CLIError({
      code: "invalid_integer",
      message: `${name} must be an integer`,
      exitCode: ExitCode.Usage,
    });
  return n;
}

export function validateLimit(value: unknown): number {
  const n = Number(value ?? 50);
  if (!Number.isInteger(n) || n < 1 || n > 50) {
    throw new CLIError({
      code: "invalid_limit",
      message: "--limit must be an integer from 1 to 50",
      hint: "Use: raindrop bookmark list --limit 50",
      exitCode: ExitCode.Usage,
    });
  }
  return n;
}

export function validateEnum(
  value: string,
  valid: string[],
  label: string,
  usage: string,
): string {
  if (!valid.includes(value)) {
    throw new CLIError({
      code: `invalid_${label}`,
      message: `Invalid ${label}: ${value}`,
      validValues: valid,
      usage,
      exitCode: ExitCode.Usage,
    });
  }
  return value;
}

export async function assertRegularFile(path: string): Promise<void> {
  const s = await stat(path).catch(() => undefined);
  if (!s || !s.isFile())
    throw new CLIError({
      code: "invalid_file",
      message: `File does not exist or is not a regular file: ${path}`,
      exitCode: ExitCode.Usage,
    });
}

export function safeProfileName(name: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(name)) {
    throw new CLIError({
      code: "invalid_profile",
      message:
        "Profile names must use only letters, numbers, dot, underscore, and dash",
      exitCode: ExitCode.Usage,
    });
  }
  return name;
}

const validConfigKeys = new Set([
  "output",
  "default_collection",
  "default_limit",
  "active_profile",
  "base_url",
  "auth_url",
  "token_url",
  "max_retries",
]);

export function validateConfigKey(key: string): void {
  if (!validConfigKeys.has(key)) {
    throw new CLIError({
      code: "invalid_config_key",
      message: `Unknown config key: ${key}`,
      validValues: [...validConfigKeys],
      hint: "Run: raindrop config list to see all valid keys",
      exitCode: ExitCode.Usage,
    });
  }
}
