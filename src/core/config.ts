import { mkdir, readFile, writeFile, rm, chmod, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { parse, stringify } from "smol-toml";
import { CLIError, ExitCode } from "./errors.js";
import { configPath, credentialsPath, profilesPath } from "./paths.js";

export type Config = {
  output?: "json" | "human";
  default_collection?: number;
  default_limit?: number;
  active_profile?: string;
  base_url?: string;
  auth_url?: string;
  token_url?: string;
  max_retries?: number;
};

export type CredentialProfile = {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_at?: string;
  client_id?: string;
  client_secret?: string;
  redirect_uri?: string;
};

export type Credentials = { profiles: Record<string, CredentialProfile> };
export type Profiles = { profiles: Record<string, Config> };

export async function readConfig(path?: string): Promise<Config> {
  const resolved = path ?? activeConfigPath();
  try {
    const text = await readFile(resolved, "utf8");
    return parse(text) as Config;
  } catch (error: any) {
    if (error?.code === "ENOENT") return {};
    throw new CLIError({
      code: "config_invalid",
      message: `Could not read config: ${error.message}`,
      exitCode: ExitCode.Failure,
    });
  }
}

let configPathOverride: string | undefined;
let runtimeCache: { key: string; value: Promise<RuntimeContext> } | undefined;

export function setConfigPathOverride(path: string | undefined): void {
  if (configPathOverride !== path) runtimeCache = undefined;
  configPathOverride = path;
}

export function activeConfigPath(): string {
  return configPathOverride ?? configPath();
}

export async function writeConfig(
  config: Config,
  path?: string,
): Promise<void> {
  runtimeCache = undefined;
  const resolved = path ?? activeConfigPath();
  await mkdir(dirname(resolved), { recursive: true });
  await writeFile(resolved, stringify(config), "utf8");
}

export async function assertPrivateFile(path: string): Promise<void> {
  if (process.platform === "win32") {
    await assertWindowsOwnerOnly(path);
    return;
  }
  try {
    const s = await stat(path);
    if ((s.mode & 0o077) !== 0) {
      throw new CLIError({
        code: "credentials_insecure_permissions",
        message: `Credential file is group/world readable: ${path}`,
        hint: "Run: chmod 600 ~/.config/raindrop/credentials.json",
        exitCode: ExitCode.Auth,
      });
    }
  } catch (error: any) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
}

function windowsOwnerPrincipal(): string | undefined {
  const user = process.env.USERNAME;
  if (!user) return undefined;
  const domain = process.env.USERDOMAIN;
  return domain ? `${domain}\\${user}` : user;
}

export async function fixPrivateFilePermissions(path: string): Promise<void> {
  if (process.platform === "win32") await setWindowsOwnerOnlyAcl(path);
  else await chmod(path, 0o600);
}

async function setWindowsOwnerOnlyAcl(path: string): Promise<void> {
  if (process.platform !== "win32") return;
  const owner = windowsOwnerPrincipal();
  if (!owner) return;
  try {
    spawnSync("icacls", [path, "/inheritance:r"], { stdio: "ignore" });
    spawnSync("icacls", [path, "/grant:r", `${owner}:F`], { stdio: "ignore" });
  } catch {
    // best effort; skip silently if icacls is unavailable
  }
}

async function assertWindowsOwnerOnly(path: string): Promise<void> {
  if (process.platform !== "win32") return;
  try {
    const s = await stat(path);
    if (!s.isFile()) return;
  } catch (error: any) {
    if (error?.code === "ENOENT") return;
    return;
  }
  const owner = windowsOwnerPrincipal();
  if (!owner) return;
  let result;
  try {
    result = spawnSync("icacls", [path], { encoding: "utf8" });
  } catch {
    return;
  }
  if (result.status !== 0 || !result.stdout) return;
  const stdout = String(result.stdout);
  const lines = stdout.split(/\r?\n/).filter((line) => /:\(/.test(line));
  const principals = lines
    .map((line) => {
      const match = /^\s*(?:\S.*?\s)?(\S.*?):\(/.exec(line);
      return match && match[1] ? match[1].trim() : null;
    })
    .filter(
      (principal): principal is string =>
        Boolean(principal) && principal !== path,
    );
  const trusted = new Set([
    owner.toLowerCase(),
    "nt authority\\system",
    "builtin\\administrators",
    "administrators",
  ]);
  const foreign = principals.filter(
    (principal) => !trusted.has(principal.toLowerCase()),
  );
  if (foreign.length > 0) {
    throw new CLIError({
      code: "credentials_insecure_permissions",
      message: `Credential file is readable by other principals on Windows: ${foreign.join(", ")}`,
      hint: "Re-run: raindrop doctor --fix-permissions",
      exitCode: ExitCode.Auth,
    });
  }
}

export async function readCredentials(
  path = credentialsPath(),
): Promise<Credentials> {
  await assertPrivateFile(path);
  try {
    return JSON.parse(await readFile(path, "utf8")) as Credentials;
  } catch (error: any) {
    if (error?.code === "ENOENT") return { profiles: {} };
    throw new CLIError({
      code: "credentials_invalid",
      message: `Could not read credentials: ${error.message}`,
      exitCode: ExitCode.Auth,
    });
  }
}

export async function writeCredentials(
  credentials: Credentials,
  path = credentialsPath(),
): Promise<void> {
  runtimeCache = undefined;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(credentials, null, 2)}\n`, {
    mode: 0o600,
  });
  if (process.platform === "win32") await setWindowsOwnerOnlyAcl(path);
  else await chmod(path, 0o600);
}

export async function deleteCredentials(
  path = credentialsPath(),
): Promise<void> {
  await rm(path, { force: true });
}

export async function readProfiles(path = profilesPath()): Promise<Profiles> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Profiles;
  } catch (error: any) {
    if (error?.code === "ENOENT") return { profiles: {} };
    throw new CLIError({
      code: "profiles_invalid",
      message: `Could not read profiles: ${error.message}`,
      exitCode: ExitCode.Failure,
    });
  }
}

export async function writeProfiles(
  profiles: Profiles,
  path = profilesPath(),
): Promise<void> {
  runtimeCache = undefined;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(profiles, null, 2)}\n`, "utf8");
}

export async function activeProfileName(explicit?: string): Promise<string> {
  if (explicit) return explicit;
  if (process.env.RAINDROP_PROFILE) return process.env.RAINDROP_PROFILE;
  const cfg = await readConfig();
  return cfg.active_profile ?? "default";
}

export type RuntimeContext = Required<
  Pick<
    Config,
    | "output"
    | "default_collection"
    | "default_limit"
    | "base_url"
    | "auth_url"
    | "token_url"
    | "max_retries"
  >
> & { profile: string };

export async function resolveRuntime(
  flags: Record<string, unknown> = {},
): Promise<RuntimeContext> {
  const key = runtimeCacheKey(flags);
  if (runtimeCache?.key === key) return runtimeCache.value;
  const value = buildRuntime(flags);
  runtimeCache = { key, value };
  return value;
}

async function buildRuntime(
  flags: Record<string, unknown>,
): Promise<RuntimeContext> {
  const cfg = await readConfig();
  const profile =
    (typeof flags.profile === "string" ? flags.profile : undefined) ??
    process.env.RAINDROP_PROFILE ??
    cfg.active_profile ??
    "default";
  const profiles = await readProfiles();
  const p = profiles.profiles[profile] ?? {};
  return {
    profile,
    output: outputFrom(flags, p, cfg),
    default_collection: firstNumber(
      flags.collection,
      process.env.RAINDROP_DEFAULT_COLLECTION,
      p.default_collection,
      cfg.default_collection,
      0,
    ),
    default_limit: firstNumber(
      flags.limit,
      process.env.RAINDROP_DEFAULT_LIMIT,
      p.default_limit,
      cfg.default_limit,
      50,
    ),
    base_url: String(
      firstDefined(
        flags.baseUrl,
        process.env.RAINDROP_BASE_URL,
        p.base_url,
        cfg.base_url,
        "https://api.raindrop.io/rest/v1",
      ),
    ),
    auth_url: String(
      firstDefined(
        process.env.RAINDROP_AUTH_URL,
        p.auth_url,
        cfg.auth_url,
        "https://raindrop.io/oauth/authorize",
      ),
    ),
    token_url: String(
      firstDefined(
        process.env.RAINDROP_TOKEN_URL,
        p.token_url,
        cfg.token_url,
        "https://raindrop.io/oauth/access_token",
      ),
    ),
    max_retries: firstNumber(
      process.env.RAINDROP_MAX_RETRIES,
      p.max_retries,
      cfg.max_retries,
      3,
    ),
  };
}

function outputFrom(
  flags: Record<string, unknown>,
  profile: Config,
  file: Config,
): "json" | "human" {
  if (flags.human) return "human";
  if (flags.json) return "json";
  return firstDefined(
    process.env.RAINDROP_OUTPUT,
    profile.output,
    file.output,
    "json",
  ) as "json" | "human";
}

function firstDefined<T>(...values: Array<T | undefined | null | "">): T {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "")
      return value as T;
  }
  return undefined as T;
}

function firstNumber(...values: unknown[]): number {
  for (const value of values) {
    const n = numberFrom(value);
    if (n !== undefined) return n;
  }
  return 0;
}

function numberFrom(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function runtimeCacheKey(flags: Record<string, unknown>): string {
  return JSON.stringify({
    configPath: activeConfigPath(),
    flags,
    env: {
      RAINDROP_PROFILE: process.env.RAINDROP_PROFILE,
      RAINDROP_OUTPUT: process.env.RAINDROP_OUTPUT,
      RAINDROP_DEFAULT_COLLECTION: process.env.RAINDROP_DEFAULT_COLLECTION,
      RAINDROP_DEFAULT_LIMIT: process.env.RAINDROP_DEFAULT_LIMIT,
      RAINDROP_BASE_URL: process.env.RAINDROP_BASE_URL,
      RAINDROP_AUTH_URL: process.env.RAINDROP_AUTH_URL,
      RAINDROP_TOKEN_URL: process.env.RAINDROP_TOKEN_URL,
      RAINDROP_MAX_RETRIES: process.env.RAINDROP_MAX_RETRIES,
    },
  });
}
