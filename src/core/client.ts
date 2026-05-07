import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { mkdir, rename, stat, rm } from "node:fs/promises";
import { dirname, basename, join } from "node:path";
import { pipeline } from "node:stream/promises";
import {
  maybeProactiveRefresh,
  refreshStoredToken,
  resolveToken,
} from "./auth.js";
import { resolveRuntime } from "./config.js";
import { CLIError, ExitCode, redact } from "./errors.js";

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";
export type ApiOptions = {
  method: HttpMethod;
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  multipart?: FormData;
  skipAuth?: boolean;
  absoluteUrl?: boolean;
  outputFile?: string;
  force?: boolean;
  profile?: string;
  baseUrl?: string;
  operationName: string;
  raw?: boolean;
};

export class ApiClient {
  constructor(private globalOptions: Record<string, unknown> = {}) {}

  async request(options: ApiOptions): Promise<unknown> {
    const runtime = await resolveRuntime({
      ...this.globalOptions,
      ...(options.profile != null ? { profile: options.profile } : {}),
      ...(options.baseUrl != null ? { baseUrl: options.baseUrl } : {}),
    });
    const url = this.makeUrl(runtime.base_url, options);
    const headers = new Headers();
    if (!options.skipAuth) {
      await maybeProactiveRefresh(runtime.profile, runtime.token_url);
      const { token } = await resolveToken(runtime.profile);
      headers.set("Authorization", `Bearer ${token}`);
    }
    let body: BodyInit | undefined;
    if (options.multipart) {
      body = options.multipart;
    } else if (options.body !== undefined) {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(options.body);
    }

    let lastResponse: Response | undefined;
    for (let attempt = 0; attempt <= runtime.max_retries; attempt++) {
      const init: RequestInit = { method: options.method, headers };
      if (body !== undefined) init.body = body;
      if (this.globalOptions.debug)
        process.stderr.write(
          `${JSON.stringify({ debug: { method: options.method, url: String(url), operation: options.operationName } })}\n`,
        );
      const response = await fetch(url, init);
      lastResponse = response;
      if (response.status === 401 && !options.skipAuth) {
        const refreshed = await refreshStoredToken(
          runtime.profile,
          runtime.token_url,
        );
        if (refreshed) {
          headers.set("Authorization", `Bearer ${refreshed}`);
          const retryInit: RequestInit = { method: options.method, headers };
          if (body !== undefined) retryInit.body = body;
          return await this.handleResponse(
            await fetch(url, retryInit),
            options,
          );
        }
      }
      if (
        !(response.status === 429 || response.status >= 500) ||
        attempt === runtime.max_retries
      ) {
        return await this.handleResponse(response, options);
      }
      await delay(backoffMs(attempt, response));
    }
    throw await errorFromResponse(lastResponse, options.operationName);
  }

  private makeUrl(baseUrl: string, options: ApiOptions): URL {
    const url = options.absoluteUrl
      ? new URL(options.path)
      : new URL(
          `${baseUrl.replace(/\/$/, "")}/${options.path.replace(/^\//, "")}`,
        );
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    return url;
  }

  private async handleResponse(
    response: Response,
    options: ApiOptions,
  ): Promise<unknown> {
    if (!response.ok)
      throw await errorFromResponse(response, options.operationName);
    if (options.outputFile)
      return await writeDownload(
        response,
        options.outputFile,
        Boolean(options.force),
      );
    if (options.raw) return await response.text();
    const ct = response.headers.get("content-type") ?? "";
    if (ct.includes("json")) return await response.json();
    const text = await response.text();
    if (!text) return { result: true };
    const firstChar = text.trimStart()[0];
    if (firstChar === "{" || firstChar === "[")
      return JSON.parse(text) as unknown;
    return { result: true, body: text };
  }
}

async function errorFromResponse(
  response: Response | undefined,
  operationName: string,
): Promise<CLIError> {
  if (!response)
    return new CLIError({
      code: "network_error",
      message: `No response for ${operationName}`,
    });
  let details: unknown;
  const text = await response.text().catch(() => "");
  try {
    details = text ? redact(JSON.parse(text)) : undefined;
  } catch {
    details = text;
  }
  const status = response.status;
  const code =
    status === 401 || status === 403
      ? "auth_failed"
      : status === 429
        ? "rate_limited"
        : "api_error";
  const exitCode =
    status === 401 || status === 403
      ? ExitCode.Auth
      : status === 429
        ? ExitCode.RateLimited
        : ExitCode.Failure;
  const requestId =
    response.headers.get("x-request-id") ??
    response.headers.get("request-id") ??
    undefined;
  const rateLimit = rateLimitFromHeaders(response.headers);
  return new CLIError({
    code,
    message: `Raindrop API ${operationName} failed with HTTP ${status}`,
    status,
    exitCode,
    details,
    ...(requestId ? { requestId } : {}),
    ...(rateLimit ? { rateLimit } : {}),
  });
}

function rateLimitFromHeaders(
  headers: Headers,
): Record<string, string | number> | undefined {
  const limit =
    headers.get("x-ratelimit-limit") ?? headers.get("ratelimit-limit");
  const remaining =
    headers.get("x-ratelimit-remaining") ?? headers.get("ratelimit-remaining");
  const reset =
    headers.get("x-ratelimit-reset") ?? headers.get("ratelimit-reset");
  const out: Record<string, string | number> = {};
  if (limit) out.limit = Number(limit) || limit;
  if (remaining) out.remaining = Number(remaining) || remaining;
  if (reset) out.reset = Number(reset) || reset;
  return Object.keys(out).length ? out : undefined;
}

async function writeDownload(
  response: Response,
  outputPath: string,
  force: boolean,
): Promise<unknown> {
  const existing = await stat(outputPath).catch(() => undefined);
  if (existing) {
    if (existing.isDirectory())
      throw new CLIError({
        code: "output_is_directory",
        message: `Output path is a directory: ${outputPath}`,
        exitCode: ExitCode.Usage,
      });
    if (!force)
      throw new CLIError({
        code: "output_exists",
        message: `Output file exists: ${outputPath}`,
        hint: "Pass --force to overwrite",
        exitCode: ExitCode.Usage,
      });
  }
  await mkdir(dirname(outputPath), { recursive: true });
  const tmp = join(
    dirname(outputPath),
    `.${basename(outputPath)}.${process.pid}.${Date.now()}.tmp`,
  );
  try {
    if (!response.body)
      throw new CLIError({
        code: "empty_download",
        message: "Response had no body",
      });
    await pipeline(
      Readable.fromWeb(
        response.body as unknown as import("node:stream/web").ReadableStream,
      ),
      createWriteStream(tmp, { flags: "wx" }),
    );
    await rename(tmp, outputPath);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
  const s = await stat(outputPath);
  return {
    result: true,
    delivered_to: `file:${outputPath}`,
    path: outputPath,
    bytes: s.size,
    content_type: response.headers.get("content-type"),
  };
}

function backoffMs(attempt: number, response: Response): number {
  const reset =
    response.headers.get("x-ratelimit-reset") ??
    response.headers.get("ratelimit-reset");
  if (reset && /^\d+$/.test(reset)) {
    const seconds = Number(reset);
    if (seconds > 0 && seconds < 120) return seconds * 1000;
  }
  return Math.min(10_000, 500 * 2 ** attempt) + Math.floor(Math.random() * 100);
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
