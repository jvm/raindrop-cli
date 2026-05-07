import { CLIError, ExitCode } from "./errors.js";
import {
  activeProfileName,
  readCredentials,
  writeCredentials,
} from "./config.js";

export type OAuthTokens = {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  expires_at?: string;
};

export async function resolveToken(
  profile?: string,
): Promise<{ token: string; source: string; profile?: string }> {
  if (process.env.RAINDROP_ACCESS_TOKEN)
    return { token: process.env.RAINDROP_ACCESS_TOKEN, source: "env" };
  const name = await activeProfileName(profile);
  const creds = await readCredentials();
  const selected =
    creds.profiles[name] ??
    (name !== "default" ? undefined : creds.profiles.default);
  if (selected?.access_token)
    return {
      token: selected.access_token,
      source: "credentials",
      profile: name,
    };
  throw new CLIError({
    code: "auth_missing",
    message: "No Raindrop.io access token configured",
    hint: "Run: raindrop auth login --token-stdin, or set RAINDROP_ACCESS_TOKEN",
    status: 401,
    exitCode: ExitCode.Auth,
  });
}

export async function storeToken(
  token: string,
  profile?: string,
): Promise<string> {
  const name = await activeProfileName(profile);
  const creds = await readCredentials();
  creds.profiles[name] = {
    ...(creds.profiles[name] ?? {}),
    access_token: token,
    token_type: "Bearer",
  };
  await writeCredentials(creds);
  return name;
}

export async function clearProfileToken(profile?: string): Promise<string> {
  const name = await activeProfileName(profile);
  const creds = await readCredentials();
  delete creds.profiles[name];
  await writeCredentials(creds);
  return name;
}

export async function maybeProactiveRefresh(
  profile: string,
  tokenUrl: string,
  skewSeconds = 60,
): Promise<void> {
  if (process.env.RAINDROP_ACCESS_TOKEN) return;
  const creds = await readCredentials();
  const current = creds.profiles[profile];
  if (!current?.expires_at || !current.refresh_token) return;
  const expiresAt = Date.parse(current.expires_at);
  if (!Number.isFinite(expiresAt)) return;
  if (expiresAt - Date.now() > skewSeconds * 1000) return;
  await refreshStoredToken(profile, tokenUrl);
}

export async function postTokenEndpoint(
  tokenUrl: string,
  body: Record<string, string>,
  failureCode: "oauth_exchange_failed" | "refresh_failed",
): Promise<OAuthTokens> {
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok)
    throw new CLIError({
      code: failureCode,
      message: `OAuth ${failureCode === "refresh_failed" ? "refresh" : "token exchange"} failed with HTTP ${response.status}`,
      status: response.status,
      exitCode: ExitCode.Auth,
    });
  return (await response.json()) as OAuthTokens;
}

export async function storeOAuthTokens(args: {
  tokens: OAuthTokens;
  profile?: string | undefined;
  clientId: string;
  clientSecret: string;
  redirectUri?: string | undefined;
}): Promise<string> {
  const profile = await activeProfileName(args.profile);
  const creds = await readCredentials();
  const existing = creds.profiles[profile] ?? {};
  const expiresAt = args.tokens.expires_in
    ? new Date(Date.now() + args.tokens.expires_in * 1000).toISOString()
    : args.tokens.expires_at;
  const refreshToken = args.tokens.refresh_token ?? existing.refresh_token;
  creds.profiles[profile] = {
    ...existing,
    access_token: args.tokens.access_token,
    ...(refreshToken ? { refresh_token: refreshToken } : {}),
    token_type: args.tokens.token_type ?? "Bearer",
    ...(expiresAt ? { expires_at: expiresAt } : {}),
    client_id: args.clientId,
    client_secret: args.clientSecret,
    ...(args.redirectUri ? { redirect_uri: args.redirectUri } : {}),
  };
  await writeCredentials(creds);
  return profile;
}

export async function refreshStoredToken(
  profile: string,
  tokenUrl: string,
): Promise<string | undefined> {
  const creds = await readCredentials();
  const current = creds.profiles[profile];
  if (!current?.refresh_token || !current.client_id || !current.client_secret)
    return undefined;
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: current.refresh_token,
      client_id: current.client_id,
      client_secret: current.client_secret,
    }),
  });
  if (!response.ok) return undefined;
  const data = (await response.json()) as Record<string, unknown>;
  const expiresIn =
    typeof data.expires_in === "number" ? data.expires_in : undefined;
  const accessToken =
    typeof data.access_token === "string" ? data.access_token : undefined;
  if (!accessToken) return undefined;
  creds.profiles[profile] = {
    ...current,
    access_token: accessToken,
    refresh_token:
      typeof data.refresh_token === "string"
        ? data.refresh_token
        : current.refresh_token,
    token_type:
      typeof data.token_type === "string" ? data.token_type : "Bearer",
    ...(expiresIn
      ? { expires_at: new Date(Date.now() + expiresIn * 1000).toISOString() }
      : {}),
  };
  await writeCredentials(creds);
  return accessToken;
}
