#!/usr/bin/env node
import { Command } from "commander";
import { execFile } from "node:child_process";
import { openAsBlob, readFileSync, realpathSync } from "node:fs";
import { createServer } from "node:http";
import { appendFile, writeFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ApiClient, delay } from "./core/client.js";
import {
  clearProfileToken,
  postTokenEndpoint,
  resolveToken,
  storeOAuthTokens,
  storeToken,
} from "./core/auth.js";
import {
  readConfig,
  writeConfig,
  readProfiles,
  writeProfiles,
  readCredentials,
  resolveRuntime,
  setConfigPathOverride,
  activeConfigPath,
  assertPrivateFile,
  fixPrivateFilePermissions,
} from "./core/config.js";
import {
  credentialsPath,
  feedbackPath,
  jobsPath,
  profilesPath,
} from "./core/paths.js";
import { CLIError, ExitCode, toCLIError } from "./core/errors.js";
import { commandSpecs } from "./generated/command-specs.js";
import {
  writeOutput,
  table,
  keyval,
  itemSummary,
  setColorEnabled,
} from "./core/output.js";
import { parseData, readStdin, mergeBody } from "./core/body.js";
import { postWebhook } from "./core/webhook.js";
import { reportInstallTelemetry } from "./core/telemetry.js";
import {
  assertRegularFile,
  backupFormats,
  bookmarkSorts,
  collectionViews,
  exportFormats,
  highlightColors,
  intArg,
  requireForce,
  safeProfileName,
  sharingRoles,
  validateConfigKey,
  validateEnum,
  validateLimit,
} from "./core/validators.js";

const version = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
).version as string;

type Handler<T extends unknown[] = unknown[]> = (...args: T) => Promise<void>;

function rootOptions(cmd?: Command): any {
  return cmd?.optsWithGlobals?.() ?? {};
}

async function mode(opts: any): Promise<"json" | "human"> {
  return (await resolveRuntime(opts)).output;
}

const LIST_ALIASES = [
  "items",
  "raindrops",
  "collections",
  "tags",
  "highlights",
  "backups",
  "covers",
  "sharing",
] as const;

function pickItems(r: any): any[] {
  return pickList(r, ...LIST_ALIASES);
}

function pickList(r: any, ...aliases: readonly string[]): any[] {
  for (const key of aliases) if (Array.isArray(r?.[key])) return r[key];
  return [];
}

function pickItem(r: any, ...aliases: readonly string[]): any {
  for (const key of aliases) if (r?.[key] !== undefined) return r[key];
  return r;
}

function pickModified(response: any): number | undefined {
  for (const key of ["modified", "modifiedCount", "matchedCount"] as const) {
    const value = response?.[key];
    if (typeof value === "number") return value;
  }
  return undefined;
}

function listEnvelope(response: any, page: number, perpage: number): any {
  const items = pickItems(response);
  const count = Number(response.count ?? items.length);
  const next = page * perpage + items.length < count ? page + 1 : undefined;
  return {
    ...response,
    items,
    page,
    perpage,
    count,
    ...(next !== undefined
      ? {
          next_page: next,
          truncated: true,
          hint: `add --page=${next} to fetch the next page`,
        }
      : { truncated: false }),
  };
}

async function render(
  value: unknown,
  human: string | undefined,
  opts: any,
): Promise<void> {
  writeOutput(value, human, await mode(opts));
}

function withErrors<T extends unknown[]>(fn: Handler<T>): Handler<T> {
  return async (...args: T) => {
    try {
      await fn(...args);
    } catch (error) {
      const e = toCLIError(error);
      process.stderr.write(`${JSON.stringify(e.envelope(), null, 2)}\n`);
      process.exitCode = e.exitCode;
    }
  };
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("raindrop")
    .description("Agent-friendly CLI for Raindrop.io")
    .version(version);
  program
    .option("--json", "force JSON output")
    .option("--human", "human output")
    .option("--debug", "request diagnostics to stderr")
    .option("--no-color", "suppress ANSI/color")
    .option("--config <path>")
    .option("--profile <name>")
    .option("--base-url <url>")
    .option("--request-schema", "print request JSON schema for the command")
    .option("--response-schema", "print response JSON schema for the command");
  program.hook("preAction", (_thisCommand, actionCommand) => {
    const opts = actionCommand.optsWithGlobals();
    if (opts.noColor) setColorEnabled(false);
    setConfigPathOverride(
      typeof opts.config === "string" && opts.config.length > 0
        ? opts.config
        : undefined,
    );
    if (opts.requestSchema || opts.responseSchema) {
      writeOutput(
        simpleSchema(
          actionCommand,
          opts.requestSchema ? "request" : "response",
        ),
        undefined,
        "json",
      );
      process.exit(0);
    }
  });

  program
    .command("update")
    .description("Print update instructions")
    .action(
      withErrors(async (_opts, cmd) =>
        render(
          { result: true, command: "pnpm add -g @mocito/raindrop-cli@latest" },
          "pnpm add -g @mocito/raindrop-cli@latest",
          rootOptions(cmd),
        ),
      ),
    );

  program
    .command("agent-context")
    .description("Print machine-readable CLI context")
    .option("--command <name>")
    .action(
      withErrors(async (opts, cmd) => {
        const profiles = await readProfiles();
        const commands = agentCommands();
        const selected = opts.command
          ? { [opts.command]: commands[opts.command] }
          : commands;
        if (opts.command && !commands[opts.command])
          throw new CLIError({
            code: "unknown_command",
            message: `Unknown agent-context command: ${opts.command}`,
            exitCode: ExitCode.Usage,
          });
        await render(
          {
            schema_version: "1",
            cli: "raindrop",
            version,
            output_contract: { stdout: "json", stderr: "structured_error" },
            commands: selected,
            global_flags: [
              "--json",
              "--human",
              "--debug",
              "--no-color",
              "--config",
              "--profile",
              "--base-url",
              "--request-schema",
              "--response-schema",
            ],
            valid_values: {
              bookmark_sort: bookmarkSorts,
              collection_view: collectionViews,
              export_format: exportFormats,
              backup_format: backupFormats,
              highlight_color: highlightColors,
              sharing_role: sharingRoles,
              delivery_sink: ["stdout", "file:<path>", "webhook:<url>"],
              system_collections: {
                "0": "All bookmarks (excluding Trash)",
                "-1": "Unsorted",
                "-99": "Trash",
              },
            },
            available_profiles: Object.keys(profiles.profiles),
            capabilities: ["json", "human", "dry_run", "delivery", "feedback"],
          },
          undefined,
          rootOptions(cmd),
        );
      }),
    );

  program
    .command("doctor")
    .description("Run structured diagnostics")
    .option("--fix-permissions")
    .action(
      withErrors(async (opts, cmd) => {
        const checks: any[] = [];

        try {
          await readConfig();
          checks.push({ name: "config_parseable", ok: true });
        } catch (e: any) {
          checks.push({ name: "config_parseable", ok: false, hint: e.message });
        }

        checks.push({
          name: "config_path",
          ok: true,
          path: activeConfigPath(),
        });

        checks.push({
          name: "credentials_path",
          ok: true,
          path: credentialsPath(),
        });

        try {
          await assertPrivateFile(credentialsPath());
          checks.push({ name: "credentials_permissions", ok: true });
        } catch (e: any) {
          if (opts.fixPermissions) {
            await fixPrivateFilePermissions(credentialsPath());
            checks.push({
              name: "credentials_permissions",
              ok: true,
              fixed: true,
            });
          } else {
            checks.push({
              name: "credentials_permissions",
              ok: false,
              hint:
                e.hint ??
                `Run: chmod 600 ${credentialsPath()} or use --fix-permissions`,
            });
          }
        }

        const optsWithGlobals = rootOptions(cmd);
        const runtime = await resolveRuntime(optsWithGlobals);
        let token: string | undefined;
        try {
          const resolved = await resolveToken(optsWithGlobals.profile);
          token = resolved.token;
          checks.push({
            name: "auth_token",
            ok: true,
            source: resolved.source,
          });
        } catch {
          checks.push({
            name: "auth_token",
            ok: false,
            hint: "Run raindrop auth login --token-stdin",
          });
        }

        if (token) {
          try {
            const resp = await fetch(`${runtime.base_url}/user`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            checks.push({ name: "api_connectivity", ok: true });
            if (resp.ok) {
              const data: any = await resp.json();
              const user = data.user ?? {};
              checks.push({
                name: "auth_user",
                ok: true,
                account: { email: user.email ?? "(redacted)" },
              });
            } else {
              checks.push({
                name: "auth_user",
                ok: false,
                status: resp.status,
              });
            }
          } catch {
            checks.push({
              name: "api_connectivity",
              ok: false,
              hint: `Cannot connect to ${runtime.base_url}`,
            });
            checks.push({
              name: "auth_user",
              ok: false,
              hint: "Cannot reach Raindrop API",
            });
          }
        } else {
          checks.push({
            name: "auth_user",
            ok: false,
            hint: "No auth token configured",
          });
          checks.push({
            name: "api_connectivity",
            ok: true,
            skipped_auth: true,
          });
        }

        try {
          const { access } = await import("node:fs/promises");
          const stateDir = dirname(jobsPath());
          await mkdir(stateDir, { recursive: true });
          await access(stateDir);
          checks.push({ name: "state_dir_writable", ok: true, path: stateDir });
        } catch (e: any) {
          checks.push({
            name: "state_dir_writable",
            ok: false,
            hint: e.message,
          });
        }

        const allOk = checks.every((c) => c.ok);
        const failedAuth =
          !allOk &&
          checks.filter((c) => !c.ok).every((c) => c.name.startsWith("auth"));

        if (failedAuth && !allOk) process.exitCode = ExitCode.Auth;
        else if (!allOk) process.exitCode = ExitCode.Failure;

        await render(
          { result: allOk, checks },
          allOk
            ? "All checks passed"
            : `Failed: ${checks
                .filter((c) => !c.ok)
                .map((c) => c.name)
                .join(", ")}`,
          rootOptions(cmd),
        );
      }),
    );

  registerAuth(program);
  registerConfig(program);
  registerProfile(program);
  registerFeedback(program);
  registerUser(program);
  registerCollections(program);
  registerBookmarks(program);
  registerTags(program);
  registerFilter(program);
  registerHighlights(program);
  registerImport(program);
  registerExport(program);
  registerBackups(program);
  registerJobs(program);
  registerApi(program);
  registerCompletion(program);
  return program;
}

function client(cmd?: Command): ApiClient {
  return new ApiClient(rootOptions(cmd));
}

function registerAuth(program: Command): void {
  const auth = program.command("auth").description("Authenticate");
  auth
    .command("login")
    .option("--token <token>")
    .option("--token-stdin")
    .option("--client-id <id>")
    .option("--client-secret <secret>")
    .option("--redirect-uri <uri>")
    .option("--manual-code <code>")
    .option("--no-browser")
    .action(
      withErrors(async (opts, cmd) => {
        let token = opts.token as string | undefined;
        if (opts.tokenStdin) token = (await readStdin()).trim();
        if (!token && opts.clientId && opts.clientSecret && opts.redirectUri) {
          if (opts.manualCode) {
            const runtime = await resolveRuntime(rootOptions(cmd));
            const tokens = await postTokenEndpoint(
              runtime.token_url,
              {
                grant_type: "authorization_code",
                code: opts.manualCode,
                client_id: opts.clientId,
                client_secret: opts.clientSecret,
                redirect_uri: opts.redirectUri,
              },
              "oauth_exchange_failed",
            );
            const profile = await storeOAuthTokens({
              tokens,
              profile: rootOptions(cmd).profile,
              clientId: opts.clientId,
              clientSecret: opts.clientSecret,
              redirectUri: opts.redirectUri,
            });
            await render(
              {
                result: true,
                profile,
                token_type: tokens.token_type ?? "Bearer",
              },
              `Logged in profile ${profile}`,
              rootOptions(cmd),
            );
            return;
          }
          const runtime = await resolveRuntime(rootOptions(cmd));
          const url = new URL(runtime.auth_url);
          url.searchParams.set("client_id", opts.clientId);
          url.searchParams.set("redirect_uri", opts.redirectUri);
          url.searchParams.set("response_type", "code");
          const redirect = new URL(opts.redirectUri);
          if (
            redirect.hostname === "127.0.0.1" ||
            redirect.hostname === "localhost"
          ) {
            const codePromise = waitForOAuthCode(redirect);
            if (opts.browser !== false) openBrowser(String(url));
            const code = await codePromise;
            const tokens = await postTokenEndpoint(
              runtime.token_url,
              {
                grant_type: "authorization_code",
                code,
                client_id: opts.clientId,
                client_secret: opts.clientSecret,
                redirect_uri: opts.redirectUri,
              },
              "oauth_exchange_failed",
            );
            const profile = await storeOAuthTokens({
              tokens,
              profile: rootOptions(cmd).profile,
              clientId: opts.clientId,
              clientSecret: opts.clientSecret,
              redirectUri: opts.redirectUri,
            });
            await render(
              {
                result: true,
                profile,
                token_type: tokens.token_type ?? "Bearer",
              },
              `Logged in profile ${profile}`,
              rootOptions(cmd),
            );
            return;
          }
          await render(
            {
              result: true,
              authorization_url: String(url),
              hint: "Open authorization_url, then rerun with --manual-code <code>",
            },
            String(url),
            rootOptions(cmd),
          );
          return;
        }
        if (!token)
          throw new CLIError({
            code: "token_required",
            message: "Provide --token/--token-stdin or OAuth client options",
            exitCode: ExitCode.Usage,
          });
        const profile = await storeToken(token, rootOptions(cmd).profile);
        await render(
          { result: true, profile },
          `Logged in profile ${profile}`,
          rootOptions(cmd),
        );
      }),
    );
  auth.command("status").action(
    withErrors(async (_opts, cmd) => {
      const resolved = await resolveToken(rootOptions(cmd).profile);
      await render(
        {
          result: true,
          authenticated: true,
          source: resolved.source,
          profile: resolved.profile,
        },
        `authenticated (${resolved.source})`,
        rootOptions(cmd),
      );
    }),
  );
  auth
    .command("logout")
    .option("--force")
    .action(
      withErrors(async (opts, cmd) => {
        requireForce(opts.force, "auth logout");
        const profile = await clearProfileToken(rootOptions(cmd).profile);
        await render(
          { result: true, profile },
          `Logged out profile ${profile}`,
          rootOptions(cmd),
        );
      }),
    );
  auth.command("refresh").action(
    withErrors(async (_opts, cmd) => {
      const runtime = await resolveRuntime(rootOptions(cmd));
      const current = (await readCredentials()).profiles[runtime.profile];
      if (
        !current?.refresh_token ||
        !current.client_id ||
        !current.client_secret
      )
        throw new CLIError({
          code: "refresh_unavailable",
          message: "Selected profile has no refresh token/client credentials",
          exitCode: ExitCode.Auth,
        });
      const tokens = await postTokenEndpoint(
        runtime.token_url,
        {
          grant_type: "refresh_token",
          refresh_token: current.refresh_token,
          client_id: current.client_id,
          client_secret: current.client_secret,
        },
        "refresh_failed",
      );
      await storeOAuthTokens({
        tokens,
        profile: rootOptions(cmd).profile,
        clientId: current.client_id,
        clientSecret: current.client_secret,
        redirectUri: current.redirect_uri,
      });
      await render(
        {
          result: true,
          profile: runtime.profile,
          token_type: tokens.token_type ?? "Bearer",
        },
        `refreshed ${runtime.profile}`,
        rootOptions(cmd),
      );
    }),
  );
}

function registerConfig(program: Command): void {
  const cfg = program.command("config").description("Manage config");
  cfg.command("path").action(
    withErrors(async (_opts, cmd) =>
      render(
        {
          result: true,
          path: activeConfigPath(),
          credentials_path: credentialsPath(),
          profiles_path: profilesPath(),
        },
        activeConfigPath(),
        rootOptions(cmd),
      ),
    ),
  );
  cfg.command("list").action(
    withErrors(async (_opts, cmd) => {
      const opts = rootOptions(cmd);
      const runtime = await resolveRuntime(opts);
      const file = await readConfig();
      const profiles = await readProfiles();
      const profileValues = profiles.profiles[runtime.profile] ?? {};
      const values = Object.fromEntries(
        Object.entries(runtime).map(([key, value]) => [
          key,
          { value, source: configSource(key, opts, profileValues, file) },
        ]),
      );
      await render(
        { result: true, values },
        Object.entries(values)
          .map(([k, v]: [string, any]) => `${k}: ${v.value} (${v.source})`)
          .join("\n"),
        rootOptions(cmd),
      );
    }),
  );
  cfg
    .command("get")
    .argument("<key>")
    .action(
      withErrors(async (key, _opts, cmd) => {
        validateConfigKey(key);
        const c: any = await readConfig();
        await render(
          { result: true, key, value: c[key] ?? null },
          String(c[key] ?? ""),
          rootOptions(cmd),
        );
      }),
    );
  cfg
    .command("set")
    .argument("<key>")
    .argument("<value>")
    .action(
      withErrors(async (key, value, _opts, cmd) => {
        validateConfigKey(key);
        const c: any = await readConfig();
        c[key] = coerceValue(value);
        await writeConfig(c);
        await render(
          { result: true, key, value: c[key] },
          `${key}=${c[key]}`,
          rootOptions(cmd),
        );
      }),
    );
  cfg
    .command("unset")
    .argument("<key>")
    .action(
      withErrors(async (key, _opts, cmd) => {
        validateConfigKey(key);
        const c: any = await readConfig();
        delete c[key];
        await writeConfig(c);
        await render({ result: true, key }, `unset ${key}`, rootOptions(cmd));
      }),
    );
}

function registerProfile(program: Command): void {
  const profile = program.command("profile").description("Manage profiles");
  profile.command("list").action(
    withErrors(async (_opts, cmd) => {
      const profiles = await readProfiles();
      await render(
        { result: true, profiles: Object.keys(profiles.profiles) },
        table(
          Object.keys(profiles.profiles).map((name) => ({ name })),
          ["name"],
        ),
        rootOptions(cmd),
      );
    }),
  );
  profile
    .command("get")
    .argument("<name>")
    .action(
      withErrors(async (name, _opts, cmd) => {
        safeProfileName(name);
        const profiles = await readProfiles();
        const creds = await readCredentials();
        await render(
          {
            result: true,
            name,
            profile: profiles.profiles[name] ?? {},
            auth: { configured: Boolean(creds.profiles[name]?.access_token) },
          },
          keyval(profiles.profiles[name] ?? {}),
          rootOptions(cmd),
        );
      }),
    );
  profile
    .command("save")
    .argument("<name>")
    .option("--default-collection <id>")
    .option("--output <mode>")
    .action(
      withErrors(async (name, opts, cmd) => {
        safeProfileName(name);
        const profiles = await readProfiles();
        profiles.profiles[name] = { ...(profiles.profiles[name] ?? {}) };
        if (opts.defaultCollection !== undefined)
          profiles.profiles[name].default_collection = intArg(
            opts.defaultCollection,
            "--default-collection",
          );
        if (opts.output !== undefined)
          profiles.profiles[name].output = validateEnum(
            opts.output,
            ["json", "human"],
            "output",
            "raindrop profile save work --output json",
          ) as any;
        await writeProfiles(profiles);
        await render(
          { result: true, name, profile: profiles.profiles[name] },
          `saved ${name}`,
          rootOptions(cmd),
        );
      }),
    );
  profile
    .command("use")
    .argument("<name>")
    .action(
      withErrors(async (name, _opts, cmd) => {
        safeProfileName(name);
        const cfg = await readConfig();
        cfg.active_profile = name;
        await writeConfig(cfg);
        await render(
          { result: true, active_profile: name },
          `using ${name}`,
          rootOptions(cmd),
        );
      }),
    );
  profile
    .command("delete")
    .argument("<name>")
    .option("--force")
    .action(
      withErrors(async (name, opts, cmd) => {
        requireForce(opts.force, "profile delete");
        const profiles = await readProfiles();
        delete profiles.profiles[name];
        await writeProfiles(profiles);
        await render(
          { result: true, name },
          `deleted ${name}`,
          rootOptions(cmd),
        );
      }),
    );
}

function registerFeedback(program: Command): void {
  const fb = program.command("feedback").description("Record local feedback");
  fb.argument("[message]").action(
    withErrors(async (message, _opts, cmd) => {
      if (!message) return;
      const entry = { ts: new Date().toISOString(), message };
      await appendJsonl(feedbackPath(), entry);
      await render(
        { result: true, entry },
        `recorded feedback`,
        rootOptions(cmd),
      );
    }),
  );
  fb.command("list").action(
    withErrors(async (_opts, cmd) => {
      const items = await readJsonl(feedbackPath());
      await render(
        { result: true, items },
        table(items, ["ts", "message"]),
        rootOptions(cmd),
      );
    }),
  );
  fb.command("clear")
    .option("--force")
    .action(
      withErrors(async (opts, cmd) => {
        requireForce(opts.force, "feedback clear");
        await truncateFile(feedbackPath());
        await render({ result: true }, "cleared feedback", rootOptions(cmd));
      }),
    );
  fb.command("send")
    .option("--endpoint <url>")
    .option("--allow-private-webhook")
    .option("--force")
    .action(
      withErrors(async (opts, cmd) => {
        const endpoint =
          opts.endpoint ?? process.env.RAINDROP_FEEDBACK_ENDPOINT;
        if (!endpoint)
          throw new CLIError({
            code: "endpoint_required",
            message: "Provide --endpoint or RAINDROP_FEEDBACK_ENDPOINT",
            hint: "raindrop feedback send --endpoint https://example.com/api/feedback",
            exitCode: ExitCode.Usage,
          });
        const items = await readJsonl(feedbackPath());
        const response = await postWebhook(
          endpoint,
          { source: "raindrop-cli", items },
          { allowPrivate: Boolean(opts.allowPrivateWebhook) },
        );
        if (opts.force) await truncateFile(feedbackPath());
        await render(
          { result: true, sent: items.length, webhook: response },
          `sent ${items.length} feedback item(s)`,
          rootOptions(cmd),
        );
      }),
    );
}

function registerUser(program: Command): void {
  const user = program.command("user").description("User operations");
  user.command("get").action(
    withErrors(async (_opts, cmd) => {
      const r: any = await client(cmd).request({
        method: "GET",
        path: "/user",
        operationName: "user.get",
      });
      const u = pickItem(r, "user", "item");
      await render(
        r,
        itemSummary(`User: ${u.fullName ?? u.email ?? u._id ?? "?"}`, {
          _id: u._id,
          email: u.email,
          fullName: u.fullName,
          pro: u.pro,
        }),
        rootOptions(cmd),
      );
    }),
  );
  user
    .command("public")
    .argument("<name>")
    .action(
      withErrors(async (name, _opts, cmd) => {
        const r: any = await client(cmd).request({
          method: "GET",
          path: `/user/${encodeURIComponent(name)}`,
          operationName: "user.public",
        });
        const u = pickItem(r, "user", "item");
        await render(
          r,
          itemSummary(`Public user: ${name}`, {
            _id: u._id,
            fullName: u.fullName,
          }),
          rootOptions(cmd),
        );
      }),
    );
  user.command("stats").action(
    withErrors(async (_opts, cmd) => {
      const r: any = await client(cmd).request({
        method: "GET",
        path: "/user/stats",
        operationName: "user.stats",
      });
      const s = r.stats ?? r;
      await render(
        r,
        keyval({
          bookmarks: s.bookmarks ?? s.count,
          collections: s.collections,
          tags: s.tags,
        }),
        rootOptions(cmd),
      );
    }),
  );
  user
    .command("update")
    .option("-d, --data <json>")
    .action(
      withErrors(async (opts, cmd) => {
        const r: any = await client(cmd).request({
          method: "PUT",
          path: "/user",
          body: await parseData(opts.data),
          operationName: "user.update",
        });
        const u = pickItem(r, "user", "item");
        await render(
          r,
          itemSummary(`Updated: ${u.fullName ?? u.email ?? "user"}`, {
            _id: u._id,
            email: u.email,
            fullName: u.fullName,
          }),
          rootOptions(cmd),
        );
      }),
    );
}

function registerCollections(program: Command): void {
  const c = program.command("collection").description("Collection operations");
  c.command("list").action(
    withErrors(async (_opts, cmd) => {
      const r: any = await client(cmd).request({
        method: "GET",
        path: "/collections",
        operationName: "collection.list",
      });
      await render(
        r,
        table(pickList(r, "items", "collections"), ["_id", "title", "count"]),
        rootOptions(cmd),
      );
    }),
  );
  c.command("children").action(
    withErrors(async (_opts, cmd) => {
      const r: any = await client(cmd).request({
        method: "GET",
        path: "/collections/childrens",
        operationName: "collection.children",
      });
      const items = pickList(r, "items", "collections");
      await render(
        r,
        table(items, ["_id", "title", "parent", "count"]),
        rootOptions(cmd),
      );
    }),
  );
  c.command("tree").action(
    withErrors(async (_opts, cmd) => {
      const api = client(cmd);
      const [user, roots, children] = await Promise.all([
        api.request({
          method: "GET",
          path: "/user",
          operationName: "user.get",
        }),
        api.request({
          method: "GET",
          path: "/collections",
          operationName: "collection.list",
        }),
        api.request({
          method: "GET",
          path: "/collections/childrens",
          operationName: "collection.children",
        }),
      ]);
      await render(
        { result: true, user, roots, children },
        treeHuman(roots, children),
        rootOptions(cmd),
      );
    }),
  );
  c.command("get")
    .argument("<id>")
    .action(
      withErrors(async (id, _opts, cmd) => {
        const r: any = await client(cmd).request({
          method: "GET",
          path: `/collection/${intArg(id, "id")}`,
          operationName: "collection.get",
        });
        const item = pickItem(r, "item", "collection");
        await render(
          r,
          itemSummary(`Collection: ${item.title ?? id}`, {
            _id: item._id,
            title: item.title,
            count: item.count,
            color: item.color,
            cover: item.cover?.url ?? item.cover,
            public: item.public,
            view: item.view,
          }),
          rootOptions(cmd),
        );
      }),
    );
  c.command("create")
    .option("--title <title>")
    .option("--view <view>")
    .option("--parent <id>")
    .option("-d, --data <json>")
    .action(
      withErrors(async (opts, cmd) => {
        const body = mergeBody(await parseData(opts.data), {
          title: opts.title,
          view: opts.view
            ? validateEnum(
                opts.view,
                collectionViews,
                "view",
                "raindrop collection create --view list",
              )
            : undefined,
          parent: opts.parent
            ? { $id: intArg(opts.parent, "--parent") }
            : undefined,
        });
        await render(
          await client(cmd).request({
            method: "POST",
            path: "/collection",
            body,
            operationName: "collection.create",
          }),
          "Created collection",
          rootOptions(cmd),
        );
      }),
    );
  c.command("update")
    .argument("<id>")
    .option("--title <title>")
    .option("--public <bool>")
    .option("--view <view>")
    .option("-d, --data <json>")
    .action(
      withErrors(async (id, opts, cmd) => {
        const body = mergeBody(await parseData(opts.data), {
          title: opts.title,
          public:
            opts.public === undefined ? undefined : opts.public === "true",
          view: opts.view
            ? validateEnum(
                opts.view,
                collectionViews,
                "view",
                "raindrop collection update 123 --view list",
              )
            : undefined,
        });
        await render(
          await client(cmd).request({
            method: "PUT",
            path: `/collection/${intArg(id, "id")}`,
            body,
            operationName: "collection.update",
          }),
          `Updated collection ${id}`,
          rootOptions(cmd),
        );
      }),
    );
  c.command("delete")
    .argument("<id>")
    .option("--force")
    .action(
      withErrors(async (id, opts, cmd) => {
        requireForce(opts.force, "collection delete");
        await render(
          await client(cmd).request({
            method: "DELETE",
            path: `/collection/${intArg(id, "id")}`,
            operationName: "collection.delete",
          }),
          `Deleted collection ${id}`,
          rootOptions(cmd),
        );
      }),
    );
  c.command("delete-many")
    .argument("<ids...>")
    .option("--force")
    .action(
      withErrors(async (ids, opts, cmd) => {
        requireForce(opts.force, "collection delete-many");
        const intIds = ids.map((id: string) => intArg(id, "id"));
        const response = await client(cmd).request({
          method: "DELETE",
          path: "/collections",
          body: { ids: intIds },
          operationName: "collection.deleteMany",
        });
        await render(
          markPartial(response, intIds.length, "modify"),
          `Deleted ${ids.length} collection(s)`,
          rootOptions(cmd),
        );
      }),
    );
  c.command("reorder")
    .requiredOption("--sort <sort>")
    .action(
      withErrors(async (opts, cmd) => {
        const sort = validateEnum(
          opts.sort,
          ["title", "-title", "count", "-count"],
          "sort",
          "raindrop collection reorder --sort title",
        );
        await render(
          await client(cmd).request({
            method: "PUT",
            path: "/collections",
            body: { sort },
            operationName: "collection.reorder",
          }),
          `Reordered collections by ${sort}`,
          rootOptions(cmd),
        );
      }),
    );
  c.command("expand")
    .option("--all")
    .action(
      withErrors(async (_opts, cmd) =>
        render(
          await client(cmd).request({
            method: "PUT",
            path: "/collections",
            body: { expanded: true },
            operationName: "collection.expand",
          }),
          "Expanded all collections",
          rootOptions(cmd),
        ),
      ),
    );
  c.command("collapse")
    .option("--all")
    .action(
      withErrors(async (_opts, cmd) =>
        render(
          await client(cmd).request({
            method: "PUT",
            path: "/collections",
            body: { expanded: false },
            operationName: "collection.collapse",
          }),
          "Collapsed all collections",
          rootOptions(cmd),
        ),
      ),
    );
  c.command("merge")
    .requiredOption("--to <id>")
    .argument("<ids...>")
    .action(
      withErrors(async (ids, opts, cmd) =>
        render(
          await client(cmd).request({
            method: "PUT",
            path: "/collections/merge",
            body: {
              to: intArg(opts.to, "--to"),
              ids: ids.map((id: string) => intArg(id, "id")),
            },
            operationName: "collection.merge",
          }),
          `Merged ${ids.length} collection(s) into ${opts.to}`,
          rootOptions(cmd),
        ),
      ),
    );
  c.command("clean-empty")
    .option("--force")
    .action(
      withErrors(async (opts, cmd) => {
        requireForce(opts.force, "collection clean-empty");
        await render(
          await client(cmd).request({
            method: "PUT",
            path: "/collections/clean",
            operationName: "collection.cleanEmpty",
          }),
          "Cleaned empty collections",
          rootOptions(cmd),
        );
      }),
    );
  c.command("empty-trash")
    .option("--force")
    .action(
      withErrors(async (opts, cmd) => {
        requireForce(opts.force, "collection empty-trash");
        await render(
          await client(cmd).request({
            method: "DELETE",
            path: "/collection/-99",
            operationName: "collection.emptyTrash",
          }),
          "Emptied Trash",
          rootOptions(cmd),
        );
      }),
    );
  const cover = c.command("cover").description("Collection covers");
  cover
    .command("upload")
    .argument("<id>")
    .requiredOption("--file <path>")
    .action(
      withErrors(async (id, opts, cmd) => {
        await assertRegularFile(opts.file);
        const form = await fileForm(opts.file, "cover");
        await render(
          await client(cmd).request({
            method: "PUT",
            path: `/collection/${intArg(id, "id")}/cover`,
            multipart: form,
            operationName: "collection.coverUpload",
          }),
          `Uploaded cover for collection ${id}`,
          rootOptions(cmd),
        );
      }),
    );
  cover
    .command("search")
    .argument("<text>")
    .action(
      withErrors(async (text, _opts, cmd) => {
        const r: any = await client(cmd).request({
          method: "GET",
          path: `/collections/covers/${encodeURIComponent(text)}`,
          operationName: "collection.coverSearch",
        });
        const items = pickList(r, "items", "covers");
        await render(
          r,
          table(
            items.map((x: any) => ({ _id: x._id, title: x.title ?? x.name })),
            ["_id", "title"],
          ),
          rootOptions(cmd),
        );
      }),
    );
  cover.command("featured").action(
    withErrors(async (_opts, cmd) => {
      const r: any = await client(cmd).request({
        method: "GET",
        path: "/collections/covers",
        operationName: "collection.coverFeatured",
      });
      const items = pickList(r, "items", "covers");
      await render(
        r,
        table(
          items.map((x: any) => ({ _id: x._id, title: x.title ?? x.name })),
          ["_id", "title"],
        ),
        rootOptions(cmd),
      );
    }),
  );
  const sharing = c.command("sharing").description("Collection sharing");
  sharing
    .command("list")
    .argument("<collection-id>")
    .action(
      withErrors(async (id, _opts, cmd) => {
        const r: any = await client(cmd).request({
          method: "GET",
          path: `/collection/${intArg(id, "collection-id")}/sharing`,
          operationName: "collection.sharingList",
        });
        const items = pickList(r, "items", "sharing");
        const rows = (Array.isArray(items) ? items : [items]).map((x: any) => ({
          user: x.user?._id ?? x.user ?? x._id,
          role: x.role,
          email: x.user?.email ?? x.email,
        }));
        await render(
          r,
          table(rows, ["user", "role", "email"]),
          rootOptions(cmd),
        );
      }),
    );
  sharing
    .command("invite")
    .argument("<collection-id>")
    .requiredOption("--role <role>")
    .option("--email <email>", "email", collect, [])
    .action(
      withErrors(async (id, opts, cmd) => {
        const role = validateEnum(
          opts.role,
          sharingRoles,
          "role",
          "raindrop collection sharing invite 123 --role viewer --email a@example.com",
        );
        if (opts.email.length > 10)
          throw new CLIError({
            code: "too_many_emails",
            message: "Sharing invite accepts at most 10 emails",
            exitCode: ExitCode.Usage,
          });
        await render(
          await client(cmd).request({
            method: "POST",
            path: `/collection/${intArg(id, "collection-id")}/sharing`,
            body: { role, emails: opts.email },
            operationName: "collection.sharingInvite",
          }),
          `Invited ${opts.email.length} user(s) as ${role}`,
          rootOptions(cmd),
        );
      }),
    );
  sharing
    .command("update")
    .argument("<collection-id>")
    .argument("<user-id>")
    .requiredOption("--role <role>")
    .action(
      withErrors(async (id, userId, opts, cmd) => {
        const role = validateEnum(
          opts.role,
          sharingRoles,
          "role",
          "raindrop collection sharing update 123 456 --role member",
        );
        await render(
          await client(cmd).request({
            method: "PUT",
            path: `/collection/${intArg(id, "collection-id")}/sharing/${intArg(userId, "user-id")}`,
            body: { role },
            operationName: "collection.sharingUpdate",
          }),
          `Updated user ${userId} to role ${role}`,
          rootOptions(cmd),
        );
      }),
    );
  sharing
    .command("remove")
    .argument("<collection-id>")
    .argument("<user-id>")
    .option("--force")
    .action(
      withErrors(async (id, userId, opts, cmd) => {
        requireForce(opts.force, "collection sharing remove");
        await render(
          await client(cmd).request({
            method: "DELETE",
            path: `/collection/${intArg(id, "collection-id")}/sharing/${intArg(userId, "user-id")}`,
            operationName: "collection.sharingRemove",
          }),
          `Removed user ${userId} from collection ${id}`,
          rootOptions(cmd),
        );
      }),
    );
  sharing
    .command("leave")
    .argument("<collection-id>")
    .option("--force")
    .action(
      withErrors(async (id, opts, cmd) => {
        requireForce(opts.force, "collection sharing leave");
        await render(
          await client(cmd).request({
            method: "DELETE",
            path: `/collection/${intArg(id, "collection-id")}/sharing`,
            operationName: "collection.sharingLeave",
          }),
          `Left collection ${id}`,
          rootOptions(cmd),
        );
      }),
    );
  sharing
    .command("join")
    .argument("<collection-id>")
    .requiredOption("--token <invite-token>")
    .action(
      withErrors(async (id, opts, cmd) =>
        render(
          await client(cmd).request({
            method: "POST",
            path: `/collection/${intArg(id, "collection-id")}/join`,
            body: { token: opts.token },
            operationName: "collection.sharingJoin",
          }),
          `Joined collection ${id}`,
          rootOptions(cmd),
        ),
      ),
    );
}

function registerBookmarks(program: Command): void {
  const b = program.command("bookmark").description("Bookmark operations");
  b.command("list")
    .option("--collection <id>")
    .option("--page <n>", "page", "0")
    .option("--limit <n>", "limit", "50")
    .option("--sort <sort>")
    .option("--search <query>")
    .action(withErrors(async (opts, cmd) => bookmarkList(opts, cmd)));
  b.command("search")
    .argument("<query>")
    .option("--collection <id>")
    .option("--page <n>", "page", "0")
    .option("--limit <n>", "limit", "50")
    .option("--sort <sort>")
    .action(
      withErrors(async (query, opts, cmd) =>
        bookmarkList({ ...opts, search: query }, cmd),
      ),
    );
  b.command("get")
    .argument("<id>")
    .action(
      withErrors(async (id, _opts, cmd) => {
        const r: any = await client(cmd).request({
          method: "GET",
          path: `/raindrop/${intArg(id, "id")}`,
          operationName: "bookmark.get",
        });
        const item = pickItem(r, "item", "raindrop");
        await render(
          r,
          itemSummary(`Bookmark: ${item.title ?? id}`, {
            _id: item._id,
            title: item.title,
            link: item.link,
            collection: item.collection?.$id ?? item.collection,
            tags: item.tags,
            important: item.important,
          }),
          rootOptions(cmd),
        );
      }),
    );
  b.command("add")
    .argument("<url>")
    .option("--title <title>")
    .option("--collection <id>")
    .option("--tag <tag>", "tag", collect, [])
    .option("--important")
    .option("--parse")
    .option("--allow-duplicate")
    .option("--dry-run")
    .action(
      withErrors(async (url, opts, cmd) => {
        const collectionId = await resolveCollectionArg(opts, cmd);
        const scope = await resolveMutationScope(cmd, collectionId);
        const body: any = {
          link: url,
          collection: { $id: collectionId },
          ...(opts.title ? { title: opts.title } : {}),
          ...(opts.tag.length ? { tags: opts.tag } : {}),
          ...(opts.important ? { important: true } : {}),
          ...(opts.parse ? { pleaseParse: {} } : {}),
        };
        if (opts.dryRun) return renderDryRun(body, scope, cmd);
        await emitScopeHeader(scope, cmd);
        if (!opts.allowDuplicate) {
          const exists: any = await client(cmd).request({
            method: "POST",
            path: "/import/url/exists",
            body: { urls: [url] },
            operationName: "import.exists",
          });
          const existing = findExisting(exists, url);
          if (existing)
            return render(
              withScope(
                { result: true, existing: true, item: existing },
                scope,
              ),
              "(existing bookmark)",
              rootOptions(cmd),
            );
        }
        await render(
          withScope(
            await client(cmd).request({
              method: "POST",
              path: "/raindrop",
              body,
              operationName: "bookmark.add",
            }),
            scope,
          ),
          "Added bookmark",
          rootOptions(cmd),
        );
      }),
    );
  b.command("create")
    .option("-d, --data <json>")
    .option("--dry-run")
    .action(
      withErrors(async (opts, cmd) => {
        const body = await parseData(opts.data);
        const bodyCollection = (body as any)?.collection;
        const collectionId =
          typeof bodyCollection === "object" &&
          bodyCollection !== null &&
          typeof bodyCollection.$id === "number"
            ? bodyCollection.$id
            : typeof bodyCollection === "number"
              ? bodyCollection
              : undefined;
        const scope = await resolveMutationScope(cmd, collectionId);
        if (opts.dryRun) return renderDryRun(body, scope, cmd);
        await emitScopeHeader(scope, cmd);
        await render(
          withScope(
            await client(cmd).request({
              method: "POST",
              path: "/raindrop",
              body,
              operationName: "bookmark.create",
            }),
            scope,
          ),
          "Created bookmark",
          rootOptions(cmd),
        );
      }),
    );
  b.command("update")
    .argument("<id>")
    .option("--title <title>")
    .option("--collection <id>")
    .option("--tag <tag>", "tag", collect, undefined)
    .option("--important <bool>")
    .option("--parse")
    .option("-d, --data <json>")
    .option("--dry-run")
    .action(
      withErrors(async (id, opts, cmd) => {
        const body = mergeBody(await parseData(opts.data), {
          title: opts.title,
          collection: opts.collection
            ? { $id: intArg(opts.collection, "--collection") }
            : undefined,
          tags: opts.tag,
          important:
            opts.important === undefined
              ? undefined
              : opts.important === "true",
          pleaseParse: opts.parse ? {} : undefined,
        });
        const scope = await resolveMutationScope(
          cmd,
          opts.collection ? intArg(opts.collection, "--collection") : undefined,
        );
        if (opts.dryRun) return renderDryRun(body, scope, cmd);
        await emitScopeHeader(scope, cmd);
        await render(
          withScope(
            await client(cmd).request({
              method: "PUT",
              path: `/raindrop/${intArg(id, "id")}`,
              body,
              operationName: "bookmark.update",
            }),
            scope,
          ),
          "Updated bookmark",
          rootOptions(cmd),
        );
      }),
    );
  b.command("delete")
    .argument("<id>")
    .option("--force")
    .action(
      withErrors(async (id, opts, cmd) => {
        requireForce(opts.force, "bookmark delete");
        const bookmarkId = intArg(id, "id");
        let resolvedCollectionId: number | undefined;
        try {
          const current: any = await client(cmd).request({
            method: "GET",
            path: `/raindrop/${bookmarkId}`,
            operationName: "bookmark.get",
          });
          const item = pickItem(current, "item", "raindrop");
          resolvedCollectionId =
            item.collection?.$id ?? item.collectionId ?? item.collection;
          if (resolvedCollectionId === -99) {
            process.stderr.write(
              JSON.stringify({
                warning:
                  "Deleting a bookmark from Trash can permanently remove it",
                bookmark_id: bookmarkId,
              }) + "\n",
            );
          }
        } catch {
          /* already deleted; DELETE below handles it */
        }
        const scope = await resolveMutationScope(cmd, resolvedCollectionId);
        await emitScopeHeader(scope, cmd);
        await render(
          withScope(
            await client(cmd).request({
              method: "DELETE",
              path: `/raindrop/${bookmarkId}`,
              operationName: "bookmark.delete",
            }),
            scope,
          ),
          "Deleted bookmark",
          rootOptions(cmd),
        );
      }),
    );
  b.command("upload-file")
    .requiredOption("--file <path>")
    .option("--collection <id>")
    .action(
      withErrors(async (opts, cmd) => {
        await assertRegularFile(opts.file);
        const collectionId = await resolveCollectionArg(opts, cmd);
        const form = await fileForm(opts.file, "file");
        form.set("collectionId", String(collectionId));
        const scope = await resolveMutationScope(cmd, collectionId);
        await emitScopeHeader(scope, cmd);
        await render(
          withScope(
            await client(cmd).request({
              method: "PUT",
              path: "/raindrop/file",
              multipart: form,
              operationName: "bookmark.uploadFile",
            }),
            scope,
          ),
          "Uploaded file bookmark",
          rootOptions(cmd),
        );
      }),
    );
  b.command("upload-cover")
    .argument("<id>")
    .requiredOption("--file <path>")
    .action(
      withErrors(async (id, opts, cmd) => {
        await assertRegularFile(opts.file);
        await render(
          await client(cmd).request({
            method: "PUT",
            path: `/raindrop/${intArg(id, "id")}/cover`,
            multipart: await fileForm(opts.file, "cover"),
            operationName: "bookmark.uploadCover",
          }),
          "Uploaded cover",
          rootOptions(cmd),
        );
      }),
    );
  b.command("download")
    .argument("<id>")
    .requiredOption("--variant <variant>")
    .requiredOption("--output <path>")
    .option("--force")
    .action(
      withErrors(async (id, opts, cmd) => {
        const variant = validateEnum(
          opts.variant,
          ["cache", "cover"],
          "variant",
          "raindrop bookmark download 123 --variant cache --output cached.html",
        );
        const bookmarkId = intArg(id, "id");
        const path =
          variant === "cache"
            ? `/raindrop/${bookmarkId}/cache`
            : `/raindrop/${bookmarkId}`;
        const query = variant === "cover" ? { redirect: "cover" } : undefined;
        await render(
          await client(cmd).request({
            method: "GET",
            path,
            ...(query ? { query } : {}),
            outputFile: opts.output,
            force: opts.force,
            operationName: "bookmark.download",
          }),
          "Downloaded",
          rootOptions(cmd),
        );
      }),
    );
  b.command("suggest")
    .argument("[id]")
    .option("--url <url>")
    .action(
      withErrors(async (id, opts, cmd) => {
        if (opts.url)
          await render(
            await client(cmd).request({
              method: "POST",
              path: "/raindrop/suggest",
              body: { link: opts.url },
              operationName: "bookmark.suggestUrl",
            }),
            "Suggestions",
            rootOptions(cmd),
          );
        else if (id)
          await render(
            await client(cmd).request({
              method: "GET",
              path: `/raindrop/${intArg(id, "id")}/suggest`,
              operationName: "bookmark.suggest",
            }),
            "Suggestions",
            rootOptions(cmd),
          );
        else
          throw new CLIError({
            code: "suggest_target_required",
            message: "Provide a bookmark id or --url",
            hint: "raindrop bookmark suggest 123  OR  raindrop bookmark suggest --url https://example.com",
            exitCode: ExitCode.Usage,
          });
      }),
    );
  b.command("bulk-create")
    .requiredOption("-d, --data <json>")
    .option("--dry-run")
    .action(
      withErrors(async (opts, cmd) => {
        const body = await parseData(opts.data);
        const items = Array.isArray(body.items) ? body.items : [];
        if (items.length < 1 || items.length > 100)
          throw new CLIError({
            code: "invalid_bulk_size",
            message: "bulk-create requires body.items with 1..100 bookmarks",
            hint: "Provide a JSON body with { items: [...] } containing 1 to 100 bookmarks",
            exitCode: ExitCode.Usage,
          });
        const scope = await resolveMutationScope(cmd);
        if (opts.dryRun) return renderDryRun(body, scope, cmd);
        await emitScopeHeader(scope, cmd);
        const response = await client(cmd).request({
          method: "POST",
          path: "/raindrops",
          body,
          operationName: "bookmark.bulkCreate",
        });
        await render(
          withScope(markPartial(response, items.length, "create"), scope),
          "Bulk created bookmarks",
          rootOptions(cmd),
        );
      }),
    );
  b.command("bulk-update")
    .requiredOption("--collection <id>")
    .requiredOption("--ids <ids>")
    .option("--tag <tag>", "tag", collect, undefined)
    .option("--title <title>")
    .option("-d, --data <json>")
    .option("--dry-run")
    .action(
      withErrors(async (opts, cmd) => {
        const collectionId = intArg(opts.collection, "--collection");
        if (collectionId === 0)
          throw new CLIError({
            code: "invalid_collection",
            message: "bulk-update cannot target collection 0",
            hint: "Use a concrete collection id, -1, or -99",
            exitCode: ExitCode.Usage,
          });
        const ids = parseIds(opts.ids);
        const body = mergeBody(await parseData(opts.data), {
          ids,
          tags: opts.tag,
          title: opts.title,
        });
        const scope = await resolveMutationScope(cmd, collectionId);
        if (opts.dryRun) return renderDryRun(body, scope, cmd);
        await emitScopeHeader(scope, cmd);
        const response = await client(cmd).request({
          method: "PUT",
          path: `/raindrops/${collectionId}`,
          body,
          operationName: "bookmark.bulkUpdate",
        });
        await render(
          withScope(markPartial(response, ids.length, "modify"), scope),
          "Bulk updated bookmarks",
          rootOptions(cmd),
        );
      }),
    );
  b.command("bulk-delete")
    .requiredOption("--collection <id>")
    .requiredOption("--ids <ids>")
    .option("--force")
    .action(
      withErrors(async (opts, cmd) => {
        requireForce(opts.force, "bookmark bulk-delete");
        const collectionId = intArg(opts.collection, "--collection");
        if (collectionId === 0)
          throw new CLIError({
            code: "invalid_collection",
            message: "bulk-delete cannot target collection 0",
            hint: "Use a concrete collection id, -1, or -99",
            exitCode: ExitCode.Usage,
          });
        const ids = parseIds(opts.ids);
        const scope = await resolveMutationScope(cmd, collectionId);
        await emitScopeHeader(scope, cmd);
        const response = await client(cmd).request({
          method: "DELETE",
          path: `/raindrops/${collectionId}`,
          body: { ids },
          operationName: "bookmark.bulkDelete",
        });
        await render(
          withScope(markPartial(response, ids.length, "modify"), scope),
          "Bulk deleted bookmarks",
          rootOptions(cmd),
        );
      }),
    );
}

async function bookmarkList(opts: any, cmd?: Command): Promise<void> {
  const collectionId = await resolveCollectionArg(opts, cmd);
  const page = intArg(String(opts.page ?? 0), "--page");
  const perpage = validateLimit(opts.limit);
  const sort = opts.sort
    ? validateEnum(
        opts.sort,
        bookmarkSorts,
        "sort",
        "raindrop bookmark list --sort -created",
      )
    : undefined;
  const r: any = await client(cmd).request({
    method: "GET",
    path: `/raindrops/${collectionId}`,
    query: { page, perpage, sort, search: opts.search },
    operationName: "bookmark.list",
  });
  const env = listEnvelope(r, page, perpage);
  await render(
    env,
    table(env.items ?? [], ["_id", "title", "link"]),
    rootOptions(cmd),
  );
}

function registerTags(program: Command): void {
  const t = program.command("tag").description("Tag operations");
  t.command("list")
    .option("--collection <id>")
    .action(
      withErrors(async (opts, cmd) => {
        const id = await resolveCollectionArg(opts, cmd, 0);
        const r: any = await client(cmd).request({
          method: "GET",
          path: `/tags/${id}`,
          operationName: "tag.list",
        });
        await render(
          r,
          table(
            pickList(r, "items", "tags").map((x: any) =>
              typeof x === "string" ? { tag: x } : x,
            ),
            ["tag", "count"],
          ),
          rootOptions(cmd),
        );
      }),
    );
  t.command("rename")
    .argument("<old>")
    .argument("<new>")
    .option("--collection <id>")
    .action(
      withErrors(async (oldName, newName, opts, cmd) => {
        validateTagName(oldName, "<old>");
        validateTagName(newName, "<new>");
        if (oldName === newName)
          throw new CLIError({
            code: "tag_rename_identical",
            message: "Old and new tag names must differ",
            usage: "raindrop tag rename old-name new-name --collection 0",
            exitCode: ExitCode.Usage,
          });
        await render(
          await client(cmd).request({
            method: "PUT",
            path: `/tags/${await resolveCollectionArg(opts, cmd, 0)}`,
            body: { replace: oldName, tags: [newName] },
            operationName: "tag.rename",
          }),
          "Renamed tag",
          rootOptions(cmd),
        );
      }),
    );
  t.command("merge")
    .argument("<new>")
    .argument("<old...>")
    .option("--collection <id>")
    .action(
      withErrors(async (newName, oldTags, opts, cmd) => {
        validateTagName(newName, "<new>");
        for (const tag of oldTags) validateTagName(tag, "<old>");
        if (oldTags.includes(newName))
          throw new CLIError({
            code: "tag_merge_includes_target",
            message: "Cannot merge a tag into itself",
            usage: "raindrop tag merge new old-a old-b --collection 0",
            exitCode: ExitCode.Usage,
          });
        await render(
          await client(cmd).request({
            method: "PUT",
            path: `/tags/${await resolveCollectionArg(opts, cmd, 0)}`,
            body: { tags: oldTags, replace: newName },
            operationName: "tag.merge",
          }),
          "Merged tags",
          rootOptions(cmd),
        );
      }),
    );
  t.command("delete")
    .argument("<tags...>")
    .option("--collection <id>")
    .option("--force")
    .action(
      withErrors(async (tags, opts, cmd) => {
        requireForce(opts.force, "tag delete");
        await render(
          await client(cmd).request({
            method: "DELETE",
            path: `/tags/${await resolveCollectionArg(opts, cmd, 0)}`,
            body: { tags },
            operationName: "tag.delete",
          }),
          "Deleted tag(s)",
          rootOptions(cmd),
        );
      }),
    );
}

function registerFilter(program: Command): void {
  program
    .command("filter")
    .description("Filter operations")
    .command("get")
    .option("--collection <id>")
    .option("--search <query>")
    .option("--tags-sort <sort>")
    .action(
      withErrors(async (opts, cmd) =>
        render(
          await client(cmd).request({
            method: "GET",
            path: `/filters/${await resolveCollectionArg(opts, cmd, 0)}`,
            query: { search: opts.search, tagsSort: opts.tagsSort },
            operationName: "filter.get",
          }),
          "Filters",
          rootOptions(cmd),
        ),
      ),
    );
}

function registerHighlights(program: Command): void {
  const h = program.command("highlight").description("Highlight operations");
  h.command("list")
    .option("--collection <id>")
    .option("--page <n>", "page", "0")
    .option("--limit <n>", "limit", "50")
    .action(
      withErrors(async (opts, cmd) => {
        const page = intArg(String(opts.page ?? 0), "--page");
        const perpage = validateLimit(opts.limit);
        const path = opts.collection
          ? `/highlights/${intArg(opts.collection, "--collection")}`
          : "/highlights";
        const r: any = await client(cmd).request({
          method: "GET",
          path,
          query: { page, perpage },
          operationName: "highlight.list",
        });
        await render(
          listEnvelope(r, page, perpage),
          table(pickList(r, "items", "highlights"), ["_id", "text", "color"]),
          rootOptions(cmd),
        );
      }),
    );
  h.command("add")
    .argument("<bookmark-id>")
    .requiredOption("--text <text>")
    .option("--color <color>", "yellow")
    .option("--note <note>")
    .option("--if-version <lastUpdate>")
    .option("--dry-run")
    .action(
      withErrors(async (id, opts, cmd) => {
        const color = validateEnum(
          opts.color,
          highlightColors,
          "color",
          "raindrop highlight add 123 --text quote --color yellow",
        );
        const current: any = await client(cmd).request({
          method: "GET",
          path: `/raindrop/${intArg(id, "bookmark-id")}`,
          operationName: "bookmark.get",
        });
        const item = pickItem(current, "item", "raindrop");
        assertIfVersion(item, opts.ifVersion);
        const highlights = [
          ...(item.highlights ?? []),
          { text: opts.text, color, note: opts.note },
        ];
        const body = { highlights };
        if (opts.dryRun) return renderDryRun(body, undefined, cmd);
        await render(
          await client(cmd).request({
            method: "PUT",
            path: `/raindrop/${intArg(id, "bookmark-id")}`,
            body,
            operationName: "highlight.add",
          }),
          "Added highlight",
          rootOptions(cmd),
        );
      }),
    );
  h.command("update")
    .argument("<bookmark-id>")
    .argument("<highlight-id>")
    .option("--text <text>")
    .option("--color <color>")
    .option("--note <note>")
    .option("--if-version <lastUpdate>")
    .option("--dry-run")
    .action(
      withErrors(async (id, highlightId, opts, cmd) => {
        const current: any = await client(cmd).request({
          method: "GET",
          path: `/raindrop/${intArg(id, "bookmark-id")}`,
          operationName: "bookmark.get",
        });
        const item = pickItem(current, "item", "raindrop");
        assertIfVersion(item, opts.ifVersion);
        const highlights = (item.highlights ?? []).map((hl: any) =>
          String(hl._id ?? hl.id) === String(highlightId)
            ? {
                ...hl,
                ...(opts.text ? { text: opts.text } : {}),
                ...(opts.color
                  ? {
                      color: validateEnum(
                        opts.color,
                        highlightColors,
                        "color",
                        "raindrop highlight update 123 abc --color green",
                      ),
                    }
                  : {}),
                ...(opts.note ? { note: opts.note } : {}),
              }
            : hl,
        );
        const body = { highlights };
        if (opts.dryRun) return renderDryRun(body, undefined, cmd);
        await render(
          await client(cmd).request({
            method: "PUT",
            path: `/raindrop/${intArg(id, "bookmark-id")}`,
            body,
            operationName: "highlight.update",
          }),
          "Updated highlight",
          rootOptions(cmd),
        );
      }),
    );
  h.command("delete")
    .argument("<bookmark-id>")
    .argument("<highlight-id>")
    .option("--force")
    .option("--if-version <lastUpdate>")
    .option("--dry-run")
    .action(
      withErrors(async (id, highlightId, opts, cmd) => {
        requireForce(opts.force, "highlight delete");
        const current: any = await client(cmd).request({
          method: "GET",
          path: `/raindrop/${intArg(id, "bookmark-id")}`,
          operationName: "bookmark.get",
        });
        const item = pickItem(current, "item", "raindrop");
        assertIfVersion(item, opts.ifVersion);
        const highlights = (item.highlights ?? []).filter(
          (hl: any) => String(hl._id ?? hl.id) !== String(highlightId),
        );
        const body = { highlights };
        if (opts.dryRun) return renderDryRun(body, undefined, cmd);
        await render(
          await client(cmd).request({
            method: "PUT",
            path: `/raindrop/${intArg(id, "bookmark-id")}`,
            body,
            operationName: "highlight.delete",
          }),
          "Deleted highlight",
          rootOptions(cmd),
        );
      }),
    );
}

function registerImport(program: Command): void {
  const i = program.command("import").description("Import helpers");
  i.command("parse-url")
    .argument("<url>")
    .action(
      withErrors(async (url, _opts, cmd) =>
        render(
          await client(cmd).request({
            method: "GET",
            path: "/import/url/parse",
            query: { url },
            operationName: "import.parseUrl",
          }),
          "Parsed URL",
          rootOptions(cmd),
        ),
      ),
    );
  i.command("exists")
    .argument("<urls...>")
    .action(
      withErrors(async (urls, _opts, cmd) => {
        const response = (await client(cmd).request({
          method: "POST",
          path: "/import/url/exists",
          body: { urls },
          operationName: "import.exists",
        })) as Record<string, unknown>;
        await render(
          { ...response, result: true },
          "URL existence check",
          rootOptions(cmd),
        );
      }),
    );
  i.command("parse-file")
    .requiredOption("--file <path>")
    .action(
      withErrors(async (opts, cmd) => {
        await assertRegularFile(opts.file);
        await render(
          await client(cmd).request({
            method: "POST",
            path: "/import/file",
            multipart: await fileForm(opts.file, "file"),
            operationName: "import.parseFile",
          }),
          "Parsed file",
          rootOptions(cmd),
        );
      }),
    );
}

function registerBackups(program: Command): void {
  const b = program.command("backup").description("Backup operations");
  b.command("list").action(
    withErrors(async (_opts, cmd) => {
      const r: any = await client(cmd).request({
        method: "GET",
        path: "/backups",
        operationName: "backup.list",
      });
      const items = pickList(r, "items", "backups");
      await render(
        r,
        table(
          items.map((x: any) => ({
            _id: x._id,
            created: x.created,
            size: x.size,
          })),
          ["_id", "created", "size"],
        ),
        rootOptions(cmd),
      );
    }),
  );
  b.command("generate")
    .option("--wait")
    .option("--timeout <duration>", "10m")
    .option("--poll-interval <duration>", "5s")
    .option("--resume", "resume the most recent in-progress backup job")
    .action(
      withErrors(async (opts, cmd) => {
        // Look for an in-progress backup.generate job from a recent retry.
        const recentInProgress = await findInProgressJob(
          "backup.generate",
          15 * 60_000,
        );
        const resuming = Boolean(opts.resume) && recentInProgress;
        if (
          !opts.resume &&
          recentInProgress &&
          opts.wait &&
          process.stderr.isTTY === false
        ) {
          await render(
            {
              result: false,
              hint: "An in-progress backup.generate job exists. Pass --resume to attach to it, or wait for the prior run to finish.",
              existing_job: recentInProgress,
            },
            "in-progress backup detected; pass --resume to attach",
            rootOptions(cmd),
          );
          process.exitCode = ExitCode.Failure;
          return;
        }
        const jobId =
          resuming && recentInProgress
            ? String(recentInProgress.id)
            : `backup-${Date.now()}`;
        let baselineId: number | undefined =
          resuming && recentInProgress
            ? (recentInProgress.baseline_id as number | undefined)
            : undefined;
        if (!resuming) {
          // Record the pre-existing latest backup id before triggering generation
          // so --wait can detect the new one rather than any pre-existing one.
          try {
            const initial: any = await client(cmd).request({
              method: "GET",
              path: "/backups",
              query: { perpage: 1 },
              operationName: "backup.list",
            });
            const items = pickList(initial, "items", "backups");
            baselineId = items.length
              ? Number(items[0]._id ?? items[0].id)
              : undefined;
          } catch {
            // continue without baseline
          }
          await appendJsonl(jobsPath(), {
            id: jobId,
            kind: "backup.generate",
            status: "started",
            started_at: new Date().toISOString(),
            baseline_id: baselineId,
          });
        }
        const started = resuming
          ? recentInProgress
          : await client(cmd).request({
              method: "GET",
              path: "/backup",
              operationName: "backup.generate",
            });
        if (!opts.wait)
          return render(
            { result: true, job_id: jobId, response: started },
            "Backup generation started",
            rootOptions(cmd),
          );
        const deadline = Date.now() + parseDurationMs(opts.timeout);
        const intervalMs = parseDurationMs(opts.pollInterval);
        let last: unknown = started;
        while (Date.now() < deadline) {
          await delay(intervalMs);
          last = await client(cmd).request({
            method: "GET",
            path: "/backups",
            query: { perpage: 1 },
            operationName: "backup.list",
          });
          const items = pickList(last, "items", "backups");
          const newest = items.length
            ? Number(items[0]._id ?? items[0].id)
            : undefined;
          const hasNewBackup =
            newest !== undefined &&
            (baselineId === undefined || newest !== baselineId);
          if (hasNewBackup) {
            await appendJsonl(jobsPath(), {
              id: jobId,
              kind: "backup.generate",
              status: "completed",
              completed_at: new Date().toISOString(),
            });
            return render(
              {
                result: true,
                job_id: jobId,
                waited: true,
                backup_id: newest,
                items,
                last,
              },
              "Backup generation complete",
              rootOptions(cmd),
            );
          }
        }
        await appendJsonl(jobsPath(), {
          id: jobId,
          kind: "backup.generate",
          status: "timeout",
          completed_at: new Date().toISOString(),
        });
        process.exitCode = ExitCode.WaitTimeout;
        await render(
          { result: false, timeout: true, last },
          "Backup generation timed out",
          rootOptions(cmd),
        );
      }),
    );
  b.command("download")
    .argument("<backup-id>")
    .argument("<format>")
    .requiredOption("--output <path>")
    .option("--force")
    .action(
      withErrors(async (id, format, opts, cmd) => {
        validateEnum(
          format,
          backupFormats,
          "format",
          "raindrop backup download 123 csv --output backup.csv",
        );
        await render(
          await client(cmd).request({
            method: "GET",
            path: `/backup/${encodeURIComponent(id)}.${format}`,
            outputFile: opts.output,
            force: opts.force,
            operationName: "backup.download",
          }),
          "Downloaded backup",
          rootOptions(cmd),
        );
      }),
    );
}

function registerJobs(program: Command): void {
  const j = program.command("jobs").description("Local async job ledger");
  j.command("list").action(
    withErrors(async (_opts, cmd) => {
      const items = await readJsonl(jobsPath());
      await render(
        { result: true, items },
        table(items, ["id", "kind", "status", "started_at"]),
        rootOptions(cmd),
      );
    }),
  );
  j.command("get")
    .argument("<job-id>")
    .action(
      withErrors(async (id, _opts, cmd) => {
        const item = (await readJsonl(jobsPath())).find(
          (job: any) => String(job.id) === String(id),
        );
        await render(
          { result: Boolean(item), job_id: id, item: item ?? null },
          item ? `Job ${id}: ${item.status}` : `Job ${id} not found`,
          rootOptions(cmd),
        );
      }),
    );
  j.command("prune")
    .option("--older-than <duration>", "30d")
    .action(
      withErrors(async (opts, cmd) => {
        const cutoff = Date.now() - parseDurationMs(opts.olderThan);
        const items = await readJsonl(jobsPath());
        const kept = items.filter(
          (job: any) =>
            Date.parse(job.started_at ?? job.ts ?? new Date().toISOString()) >=
            cutoff,
        );
        await mkdir(dirname(jobsPath()), { recursive: true });
        await writeFile(
          jobsPath(),
          kept.map((job) => JSON.stringify(job)).join("\n") +
            (kept.length ? "\n" : ""),
          "utf8",
        );
        await render(
          {
            result: true,
            pruned: items.length - kept.length,
            older_than: opts.olderThan,
          },
          `pruned ${items.length - kept.length} jobs`,
          rootOptions(cmd),
        );
      }),
    );
}

function registerExport(program: Command): void {
  const e = program.command("export").description("Export bookmarks");
  e.command("bookmarks")
    .argument("<collection>")
    .argument("<format>")
    .option("--search <query>")
    .option("--output <path>")
    .option("--deliver <sink>")
    .option("--allow-private-webhook")
    .option("--force")
    .action(
      withErrors(async (collection, format, opts, cmd) => {
        validateEnum(
          format,
          exportFormats,
          "format",
          "raindrop export bookmarks 0 csv --output bookmarks.csv",
        );
        if (opts.output && opts.deliver)
          throw new CLIError({
            code: "delivery_conflict",
            message: "--output and --deliver are mutually exclusive",
            exitCode: ExitCode.Usage,
          });
        const sink = parseSink(
          opts.deliver ?? (opts.output ? `file:${opts.output}` : undefined),
        );
        const exportPath = `/raindrops/${intArg(collection, "collection")}/export.${format}`;
        if (sink.kind === "stdout") {
          const raw = await client(cmd).request({
            method: "GET",
            path: exportPath,
            query: { search: opts.search },
            operationName: "export.bookmarks",
            raw: true,
          });
          process.stdout.write(String(raw));
          return;
        }
        if (sink.kind === "webhook") {
          const raw = await client(cmd).request({
            method: "GET",
            path: exportPath,
            query: { search: opts.search },
            operationName: "export.bookmarks",
            raw: true,
          });
          await render(
            {
              result: true,
              delivered_to: `webhook:${sink.url}`,
              webhook: await postWebhook(sink.url, raw, {
                allowPrivate: Boolean(opts.allowPrivateWebhook),
              }),
            },
            "Sent to webhook",
            rootOptions(cmd),
          );
          return;
        }
        await render(
          await client(cmd).request({
            method: "GET",
            path: exportPath,
            query: { search: opts.search },
            outputFile: sink.path,
            force: opts.force,
            operationName: "export.bookmarks",
          }),
          "Exported",
          rootOptions(cmd),
        );
      }),
    );
}

function registerApi(program: Command): void {
  program
    .command("api")
    .description("Raw API access")
    .command("request")
    .argument("<method>")
    .argument("<path>")
    .option("--query <kv>", "query", collect, [])
    .option("-d, --data <json>")
    .option("--absolute-url")
    .option("--no-auth")
    .option("--force")
    .action(
      withErrors(async (method, path, opts, cmd) => {
        const m = validateEnum(
          String(method).toUpperCase(),
          ["GET", "POST", "PUT", "DELETE"],
          "method",
          "raindrop api request GET /user",
        ) as any;
        if (
          ["DELETE", "PUT", "POST"].includes(m) &&
          !opts.force &&
          m === "DELETE"
        )
          requireForce(opts.force, "api request DELETE");
        if (/^https?:/.test(path) && !opts.absoluteUrl)
          throw new CLIError({
            code: "absolute_url_requires_flag",
            message: "Absolute URLs require --absolute-url",
            exitCode: ExitCode.Usage,
          });
        const query: Record<string, string> = {};
        for (const pair of opts.query ?? []) {
          const [k, ...rest] = String(pair).split("=");
          if (k) query[k] = rest.join("=");
        }
        await render(
          await client(cmd).request({
            method: m,
            path,
            query,
            body: opts.data ? await parseData(opts.data) : undefined,
            absoluteUrl: opts.absoluteUrl,
            skipAuth: opts.noAuth,
            operationName: "api.request",
          }),
          undefined,
          rootOptions(cmd),
        );
      }),
    );
}

function registerCompletion(program: Command): void {
  program
    .command("completion")
    .argument("<shell>")
    .action(
      withErrors(async (shell, _opts, _cmd) => {
        const sh = validateEnum(
          shell,
          ["bash", "zsh", "fish", "powershell"],
          "shell",
          "raindrop completion bash",
        );
        const script = completionScript(program, sh);
        process.stdout.write(script.endsWith("\n") ? script : `${script}\n`);
      }),
    );
}

function openBrowser(url: string): void {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  execFile(command, args, () => undefined);
}

function waitForOAuthCode(redirectUri: URL): Promise<string> {
  const port = Number(redirectUri.port || 80);
  const pathname = redirectUri.pathname;
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      try {
        const url = new URL(req.url ?? "/", `http://${redirectUri.host}`);
        if (url.pathname !== pathname) {
          res.writeHead(404).end("Not found");
          return;
        }
        const error = url.searchParams.get("error");
        const code = url.searchParams.get("code");
        if (error || !code) {
          res
            .writeHead(400)
            .end("Raindrop CLI login failed. You may close this tab.");
          reject(
            new CLIError({
              code: "oauth_callback_failed",
              message: error ?? "OAuth callback did not include a code",
              exitCode: ExitCode.Auth,
            }),
          );
        } else {
          res
            .writeHead(200)
            .end("Raindrop CLI login complete. You may close this tab.");
          resolve(code);
        }
      } finally {
        server.close();
      }
    });
    server.on("error", reject);
    server.listen(port, redirectUri.hostname);
  });
}

async function fileForm(path: string, fieldName: string): Promise<FormData> {
  const form = new FormData();
  const file = await openAsBlob(path, { type: "application/octet-stream" });
  form.set(fieldName, file, path.split(/[\\/]/).pop() ?? "upload");
  return form;
}

async function findInProgressJob(
  kind: string,
  withinMs: number,
): Promise<Record<string, unknown> | undefined> {
  const items = await readJsonl(jobsPath()).catch(() => [] as any[]);
  const latest = new Map<string, any>();
  for (const item of items) {
    if (!item || item.kind !== kind || !item.id) continue;
    latest.set(String(item.id), item);
  }
  const cutoff = Date.now() - withinMs;
  for (const job of [...latest.values()].reverse()) {
    if (job.status !== "started") continue;
    const startedAt = Date.parse(job.started_at ?? "");
    if (!Number.isFinite(startedAt) || startedAt < cutoff) continue;
    return job;
  }
  return undefined;
}

async function readJsonl(path: string): Promise<any[]> {
  const text = await readFile(path, "utf8").catch(() => "");
  return text.trim()
    ? text
        .trim()
        .split(/\n/)
        .map((line) => JSON.parse(line))
    : [];
}

async function appendJsonl(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(value)}\n`, "utf8");
}

async function truncateFile(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, "", "utf8");
}

function parseIds(value: string): number[] {
  const ids = value.split(",").map((id) => intArg(id.trim(), "--ids"));
  if (ids.length === 0)
    throw new CLIError({
      code: "ids_required",
      message: "At least one id is required",
      hint: "Use comma-separated ids: --ids 1,2,3",
      exitCode: ExitCode.Usage,
    });
  return ids;
}

const collectionTitleCache = new Map<number, string>();

async function lookupCollectionTitle(
  cmd: Command | undefined,
  collectionId: number,
): Promise<string | undefined> {
  if (collectionTitleCache.has(collectionId))
    return collectionTitleCache.get(collectionId);
  if (collectionId === 0) {
    collectionTitleCache.set(collectionId, "All bookmarks");
    return "All bookmarks";
  }
  if (collectionId === -1) {
    collectionTitleCache.set(collectionId, "Unsorted");
    return "Unsorted";
  }
  if (collectionId === -99) {
    collectionTitleCache.set(collectionId, "Trash");
    return "Trash";
  }
  try {
    const response: any = await client(cmd).request({
      method: "GET",
      path: `/collection/${collectionId}`,
      operationName: "collection.get",
    });
    const item = pickItem(response, "item", "collection");
    const title = typeof item?.title === "string" ? item.title : undefined;
    if (title) collectionTitleCache.set(collectionId, title);
    return title;
  } catch {
    return undefined;
  }
}

async function resolveMutationScope(
  cmd: Command | undefined,
  collectionId?: number,
): Promise<{
  profile: string;
  collection_id?: number;
  collection_title?: string;
}> {
  const runtime = await resolveRuntime(rootOptions(cmd));
  const scope: {
    profile: string;
    collection_id?: number;
    collection_title?: string;
  } = { profile: runtime.profile };
  if (collectionId !== undefined) {
    scope.collection_id = collectionId;
    if (runtime.output === "human" || isSystemCollection(collectionId)) {
      const title = await lookupCollectionTitle(cmd, collectionId);
      if (title) scope.collection_title = title;
    }
  }
  return scope;
}

async function emitScopeHeader(
  scope: { profile: string; collection_id?: number; collection_title?: string },
  cmd: Command | undefined,
): Promise<void> {
  const runtime = await resolveRuntime(rootOptions(cmd));
  if (runtime.output !== "human") return;
  const collection =
    scope.collection_title && scope.collection_id !== undefined
      ? `${scope.collection_title} (${scope.collection_id})`
      : scope.collection_id !== undefined
        ? String(scope.collection_id)
        : undefined;
  const parts = [`profile=${scope.profile}`];
  if (collection) parts.push(`collection=${collection}`);
  process.stderr.write(`-> ${parts.join(" ")}\n`);
}

type Sink =
  | { kind: "stdout" }
  | { kind: "file"; path: string }
  | { kind: "webhook"; url: string };

function parseSink(s: string | undefined): Sink {
  if (!s || s === "stdout") return { kind: "stdout" };
  if (s.startsWith("file:")) return { kind: "file", path: s.slice(5) };
  if (s.startsWith("webhook:")) return { kind: "webhook", url: s.slice(8) };
  throw new CLIError({
    code: "invalid_delivery",
    message: `Unsupported delivery sink: ${s}`,
    validValues: ["stdout", "file:<path>", "webhook:<url>"],
    exitCode: ExitCode.Usage,
  });
}

async function resolveCollectionArg(
  opts: any,
  cmd: Command | undefined,
  fallback?: number,
): Promise<number> {
  if (opts.collection !== undefined)
    return intArg(String(opts.collection), "--collection");
  if (fallback !== undefined) return fallback;
  return (await resolveRuntime(rootOptions(cmd))).default_collection;
}

function isSystemCollection(collectionId: number): boolean {
  return collectionId === 0 || collectionId === -1 || collectionId === -99;
}

function withScope(value: any, scope: any): any {
  if (!value || typeof value !== "object") return value;
  return { ...value, target: scope };
}

async function renderDryRun(
  body: unknown,
  scope: any,
  cmd: Command | undefined,
): Promise<void> {
  const value = { result: true, dry_run: true, request: body };
  await render(
    scope ? withScope(value, scope) : value,
    "(dry run)",
    rootOptions(cmd),
  );
}

function validateTagName(value: string, label: string): void {
  if (typeof value !== "string" || value.trim() === "")
    throw new CLIError({
      code: "invalid_tag",
      message: `${label} must be a non-empty tag name`,
      usage: "raindrop tag rename old-name new-name --collection 0",
      exitCode: ExitCode.Usage,
    });
}

function assertIfVersion(item: any, expected: string | undefined): void {
  if (!expected) return;
  const current = item?.lastUpdate ?? item?.lastUpdated ?? item?.updated;
  if (current === undefined || current === null)
    throw new CLIError({
      code: "version_unknown",
      message:
        "Bookmark does not expose a comparable version field for --if-version",
      hint: "Omit --if-version, or refresh after the API exposes lastUpdate",
      exitCode: ExitCode.Usage,
    });
  if (String(current) !== String(expected))
    throw new CLIError({
      code: "version_mismatch",
      message: `Bookmark version ${String(current)} does not match --if-version ${String(expected)}`,
      hint: "Re-fetch the bookmark and rerun with the latest --if-version",
      exitCode: ExitCode.Usage,
    });
}

function markPartial(
  response: any,
  expected: number,
  kind: "create" | "modify",
): any {
  if (!response || typeof response !== "object") return response;
  const items = pickList(response, "items", "raindrops");
  const itemsLen = items.length || undefined;
  const modified = pickModified(response);
  const actual =
    kind === "create" ? (itemsLen ?? modified) : (modified ?? itemsLen);
  if (
    typeof actual === "number" &&
    Number.isFinite(actual) &&
    actual < expected
  ) {
    process.exitCode = ExitCode.Partial;
    return {
      ...response,
      partial: true,
      expected_count: expected,
      modified_count: actual,
    };
  }
  return response;
}

function parseDurationMs(value: string): number {
  const match = /^(\d+)(ms|s|m|h|d)?$/.exec(value);
  if (!match)
    throw new CLIError({
      code: "invalid_duration",
      message: `Invalid duration: ${value}`,
      hint: "Use values like 30s, 10m, 1h",
      exitCode: ExitCode.Usage,
    });
  const amount = Number(match[1]);
  const unit = match[2] ?? "ms";
  return (
    amount *
    ({ ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit] ?? 1)
  );
}

function collect(value: string, previous: string[] = []): string[] {
  previous.push(value);
  return previous;
}
function configSource(
  key: string,
  flags: Record<string, unknown>,
  profile: Record<string, unknown>,
  file: Record<string, unknown>,
): string {
  if (
    (key === "output" && (flags.human || flags.json)) ||
    (key === "base_url" && flags.baseUrl) ||
    (key === "profile" && flags.profile)
  )
    return "flag";
  const envName = `RAINDROP_${key.toUpperCase()}`;
  if (
    process.env[envName] ||
    (key === "profile" && process.env.RAINDROP_PROFILE) ||
    (key === "output" && process.env.RAINDROP_OUTPUT)
  )
    return "env";
  if (key in profile) return "profile";
  if (key in file) return "file";
  return "default";
}

function coerceValue(value: string): any {
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+$/.test(value)) return Number(value);
  return value;
}
function findExisting(response: any, url: string): unknown {
  const values = [
    response.item,
    ...(response.items ?? []),
    ...(response.result && typeof response.result === "object"
      ? Object.values(response.result)
      : []),
  ].filter(Boolean);
  return values.find((x: any) => x.link === url || x.url === url || x._id);
}

function completionScript(program: Command, shell: string): string {
  const commands = program.commands.map((command) => command.name()).join(" ");
  if (shell === "fish") return `complete -c raindrop -f -a '${commands}'`;
  if (shell === "powershell")
    return `Register-ArgumentCompleter -CommandName raindrop -ScriptBlock { param($wordToComplete) '${commands}'.Split(' ') | Where-Object { $_ -like '$wordToComplete*' } }`;
  return `_raindrop_complete() { COMPREPLY=( $(compgen -W "${commands}" -- "\${COMP_WORDS[1]}") ); }\ncomplete -F _raindrop_complete raindrop`;
}

function treeHuman(roots: any, children: any): string {
  const rootItems = pickList(roots, "items", "collections");
  const childItems = pickList(children, "items", "collections", "childrens");
  const all = [...rootItems, ...childItems];
  if (all.length === 0) return "(no collections)";
  return table(
    all.map((c: any) => ({
      _id: c._id,
      title: c.title ?? "(untitled)",
      parent: c.parent?.$id ?? c.parent ?? "-",
      count: c.count ?? 0,
    })),
    ["_id", "title", "parent", "count"],
  );
}

function simpleSchema(
  command: Command,
  kind: "request" | "response",
): Record<string, unknown> {
  return {
    result: true,
    schema_version: "1",
    command: command.name(),
    kind,
    schema:
      kind === "request"
        ? { type: "object", additionalProperties: true }
        : {
            type: "object",
            properties: { result: { type: "boolean" } },
            additionalProperties: true,
          },
  };
}

function agentCommands(): Record<string, any> {
  const out: Record<string, { summary: string; examples: string[] }> = {};
  for (const spec of commandSpecs) {
    out[spec.name] = { summary: spec.summary, examples: spec.examples };
  }
  return out;
}

function isMainModule(): boolean {
  if (!process.argv[1]) return false;
  try {
    return (
      realpathSync(fileURLToPath(import.meta.url)) ===
      realpathSync(process.argv[1])
    );
  } catch {
    return false;
  }
}

if (isMainModule()) {
  void reportInstallTelemetry(version);
  await buildProgram().parseAsync(process.argv);
}
