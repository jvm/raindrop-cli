import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { CLIError, ExitCode } from "./errors.js";

export async function postWebhook(
  endpoint: string,
  payload: unknown,
  options: { allowPrivate?: boolean } = {},
): Promise<Record<string, unknown>> {
  const url = new URL(endpoint);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new CLIError({
      code: "invalid_webhook_url",
      message: "Webhook endpoint must be http or https",
      exitCode: ExitCode.Usage,
    });
  }
  await assertPublicWebhookHost(url, Boolean(options.allowPrivate));
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  const response = await fetch(url, {
    method: "POST",
    redirect: "manual",
    headers: {
      "Content-Type":
        typeof payload === "string" ? "text/plain" : "application/json",
    },
    body,
  });
  if (response.status >= 300 && response.status < 400) {
    throw new CLIError({
      code: "webhook_redirect_blocked",
      message: "Webhook redirects are blocked to prevent SSRF bypasses",
      hint: "Use the final public HTTPS webhook URL directly",
      status: response.status,
      exitCode: ExitCode.Usage,
    });
  }
  if (!response.ok)
    throw new CLIError({
      code: "webhook_failed",
      message: `Webhook returned HTTP ${response.status}`,
      status: response.status,
      exitCode: ExitCode.Failure,
    });
  return {
    status: response.status,
    content_type: response.headers.get("content-type"),
  };
}

async function assertPublicWebhookHost(
  url: URL,
  allowPrivate: boolean,
): Promise<void> {
  if (allowPrivate) return;
  const hostname = url.hostname;
  if (!hostname)
    throw new CLIError({
      code: "invalid_webhook_url",
      message: "Webhook URL has no hostname",
      exitCode: ExitCode.Usage,
    });
  if (hostname === "localhost" || hostname === "ip6-localhost")
    throw blockedWebhookError(hostname);
  const address = isIP(hostname) ? hostname : "";
  if (address) {
    if (isPrivateIp(address)) throw blockedWebhookError(address);
    return;
  }
  try {
    const resolved = await lookup(hostname, { all: true, verbatim: true });
    const blocked = resolved.find((entry) => isPrivateIp(entry.address));
    if (blocked) throw blockedWebhookError(blocked.address);
  } catch (error) {
    if (error instanceof CLIError) throw error;
    throw new CLIError({
      code: "webhook_resolve_failed",
      message: `Could not resolve webhook host: ${hostname}`,
      exitCode: ExitCode.Failure,
    });
  }
}

function blockedWebhookError(target: string): CLIError {
  return new CLIError({
    code: "private_webhook_blocked",
    message: `Webhook host resolves to a private/loopback address: ${target}`,
    hint: "Pass --allow-private-webhook to override (only for trusted internal endpoints)",
    exitCode: ExitCode.Usage,
  });
}

export function isPrivateIp(ip: string): boolean {
  if (!ip) return false;
  const normalized = normalizeMappedIpv4(ip.toLowerCase());
  if (isIP(normalized) === 4) return isPrivateIpv4(normalized);
  if (isIP(normalized) === 6) return isPrivateIpv6(normalized);
  return false;
}

function normalizeMappedIpv4(ip: string): string {
  return ip.startsWith("::ffff:") ? ip.slice(7) : ip;
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part)))
    return false;
  const [a, b] = parts as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a === 169 && b === 254) return true; // link-local / metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0 && parts[2] === 0) return true;
  if (a === 192 && b === 0 && parts[2] === 2) return true; // TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmark
  if (a === 198 && b === 51 && parts[2] === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && parts[2] === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast/reserved/broadcast
  return false;
}

function isPrivateIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  return (
    lower === "::" ||
    lower === "::1" ||
    lower.startsWith("fc") ||
    lower.startsWith("fd") ||
    lower.startsWith("fe8") ||
    lower.startsWith("fe9") ||
    lower.startsWith("fea") ||
    lower.startsWith("feb") ||
    lower.startsWith("ff") ||
    lower.startsWith("2001:db8:")
  );
}
