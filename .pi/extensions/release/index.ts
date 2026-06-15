import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type AutocompleteItem } from "@earendil-works/pi-tui";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface CommandResult {
  stdout: string;
  stderr: string;
  code: number;
}

interface TolerantResult {
  stdout: string;
  stderr: string;
  code: number;
}

interface FileSnapshot {
  path: string;
  content?: string;
}

interface CurrentState {
  packageName: string;
  currentVersion: string;
  changelogPath: string;
  hasUnreleased: boolean;
  hasFooter: boolean;
}

const RELEASE_FILES = [
  "package.json",
  "CHANGELOG.md",
  "docs/commands.md",
  "src/generated/command-specs.ts",
  "pnpm-lock.yaml",
] as const;

const REPO_OWNER = "jvm";
const REPO_NAME = "raindrop-cli";
const REPO_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}`;
const WORKFLOW_RUN_URL = `${REPO_URL}/actions/workflows/release.yml`;
const DIFF_LINE_LIMIT = 120;

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function isSemver(value: string): boolean {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value);
}

function suggestNextPatchVersion(version: string | undefined): string {
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`Cannot suggest next version from current version: ${version ?? "<missing>"}`);
  }
  const [major, minor, patch] = version.split(".").map(Number);
  return `${major}.${minor}.${patch + 1}`;
}

function readCurrentState(cwd: string): CurrentState {
  const packageJsonPath = join(cwd, "package.json");
  if (!existsSync(packageJsonPath)) {
    throw new Error("No package.json found in current directory.");
  }
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
    name?: string;
    version?: string;
  };
  if (!packageJson.name) throw new Error("package.json is missing the name field.");
  if (!packageJson.version) throw new Error("package.json is missing the version field.");
  if (!isSemver(packageJson.version)) {
    throw new Error(`package.json version is not valid semver: ${packageJson.version}`);
  }

  const changelogPath = join(cwd, "CHANGELOG.md");
  if (!existsSync(changelogPath)) {
    throw new Error("No CHANGELOG.md found in current directory.");
  }
  const changelog = readFileSync(changelogPath, "utf8");
  const hasUnreleased = /^## \[Unreleased\]/m.test(changelog);
  const hasFooter = /^\[Unreleased\]:/m.test(changelog);

  return {
    packageName: packageJson.name,
    currentVersion: packageJson.version,
    changelogPath,
    hasUnreleased,
    hasFooter,
  };
}

function parseArgs(args: string): { version?: string; yes: boolean } {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  if (parts.length > 2) {
    throw new Error("Usage: /release [version] [--yes]");
  }
  let version: string | undefined;
  let yes = false;
  for (const part of parts) {
    if (part === "--yes" || part === "-y") {
      yes = true;
    } else if (part.startsWith("-")) {
      throw new Error(`Unknown flag: ${part}. Supported flags: --yes, -y`);
    } else if (version === undefined) {
      version = part;
    } else {
      throw new Error("Usage: /release [version] [--yes]");
    }
  }
  if (version && !isSemver(version)) {
    throw new Error(
      `Invalid semver version: ${version}. Expected format: X.Y.Z (optionally with -prerelease or +build).`,
    );
  }
  return { version, yes };
}

function snapshotFiles(paths: readonly string[]): FileSnapshot[] {
  return paths.map((path) => ({
    path,
    content: existsSync(path) ? readFileSync(path, "utf8") : undefined,
  }));
}

function restoreFiles(snapshots: readonly FileSnapshot[]): void {
  for (const snapshot of snapshots) {
    if (snapshot.content !== undefined) {
      writeFileSync(snapshot.path, snapshot.content);
    }
  }
}

function updateJsonFile(path: string, update: (value: Record<string, unknown>) => void): void {
  const value = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  update(value);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * Draft the proposed new CHANGELOG section for the editor. Pulls any
 * [Unreleased] content forward as the body; if no [Unreleased] exists
 * (the common case after a release is cut), the body is empty.
 */
function draftChangelogSection(
  changelog: string,
  hasUnreleased: boolean,
  newVersion: string,
  date: string,
): string {
  const header = `## [${newVersion}] - ${date}`;
  if (!hasUnreleased) {
    return `${header}\n`;
  }
  const match = changelog.match(/^## \[Unreleased\][ \t]*\n((?:(?!^## ).*\n?)*)/m);
  const body = match?.[1]?.trim() ?? "";
  if (body === "") {
    return `${header}\n`;
  }
  return `${header}\n\n${body}\n`;
}

/**
 * Apply the edited new section to the CHANGELOG. Replaces the entire
 * [Unreleased] block with [Unreleased] + the new section, so the new
 * version is the only thing that owns the user's authored content.
 */
function applyChangelogEdit(changelog: string, hasUnreleased: boolean, newSection: string): string {
  const normalized = newSection.trimEnd() + "\n";
  if (hasUnreleased) {
    return changelog.replace(
      /^(## \[Unreleased\])[ \t]*\n((?:(?!^## ).*\n?)*)/m,
      `$1\n\n${normalized}`,
    );
  }
  return changelog.replace(/^(## \[\d)/m, `## [Unreleased]\n\n${normalized}\n\n$1`);
}

/**
 * Insert a new compare-link line for the new version and rebase the
 * [Unreleased] line to point from the new tag to HEAD. Leaves existing
 * lines below untouched.
 */
function updateChangelogFooter(changelog: string, newVersion: string): string {
  const footerPattern = /^(\[Unreleased\]: https:\/\/github\.com\/[^/]+\/[^/]+\/compare\/)v[\d.]+(\.\.\.HEAD)$/m;
  const match = changelog.match(footerPattern);
  if (!match) return changelog;

  const headLine = match[0];
  const prefix = match[1];
  const suffix = match[2];
  const prevTagMatch = headLine.match(/compare\/(v[\d.]+)\.\.\.HEAD$/);
  if (!prevTagMatch) return changelog;

  const prevTag = prevTagMatch[1];
  const newUnreleasedLine = `${prefix}v${newVersion}${suffix}`;
  const newVersionLine = `[${newVersion}]: ${REPO_URL}/compare/${prevTag}...v${newVersion}`;
  return changelog.replace(footerPattern, `${newUnreleasedLine}\n${newVersionLine}`);
}

function applyPackageJsonVersionEdit(packageJson: string, newVersion: string): string {
  const value = JSON.parse(packageJson) as { version?: string };
  value.version = newVersion;
  return `${JSON.stringify(value, null, 2)}\n`;
}

function applyRelease(cwd: string, state: CurrentState, version: string, editedSection: string): void {
  updateJsonFile(join(cwd, "package.json"), (pkg) => {
    pkg.version = version;
  });

  const changelog = readFileSync(state.changelogPath, "utf8");
  let updated = applyChangelogEdit(changelog, state.hasUnreleased, editedSection);
  if (state.hasFooter) {
    updated = updateChangelogFooter(updated, version);
  }
  writeFileSync(state.changelogPath, updated);
}

async function run(command: string, cwd: string): Promise<CommandResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn("bash", ["-lc", command], { cwd, env: process.env });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      const exit = code ?? -1;
      if (exit === 0) {
        resolve({ stdout, stderr, code: exit });
      } else {
        const output = [stderr.trim(), stdout.trim()].filter(Boolean).join("\n");
        reject(new Error(`Command failed with exit code ${exit}: ${command}${output ? `\n${output}` : ""}`));
      }
    });
  });
}

async function runTolerant(command: string, cwd: string): Promise<TolerantResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn("bash", ["-lc", command], { cwd, env: process.env });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ stdout, stderr, code: code ?? -1 });
    });
  });
}

function parseGitStatus(output: string): string[] {
  return output
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => line.slice(3));
}

function ensureCleanForRelease(statusPaths: string[]): { hasChanges: boolean } {
  const allowed = new Set<string>(RELEASE_FILES);
  const unrelated = statusPaths.filter((path) => !allowed.has(path));
  if (unrelated.length > 0) {
    throw new Error(
      `Working tree has changes outside the release files:\n${unrelated.map((path) => `- ${path}`).join("\n")}\n\nCommit, stash, or revert these before releasing.`,
    );
  }
  return { hasChanges: statusPaths.length > 0 };
}

async function generateUnifiedDiff(before: string, after: string, label: string, cwd: string): Promise<string> {
  const tmpDir = mkdtempSync(join(tmpdir(), "rd-release-diff-"));
  const beforeFile = join(tmpDir, `a-${label}`);
  const afterFile = join(tmpDir, `b-${label}`);
  try {
    writeFileSync(beforeFile, before);
    writeFileSync(afterFile, after);
    // `git diff --no-index` returns 0 if identical, 1 if different, 2+ on error.
    const result = await runTolerant(
      `git diff --no-index --no-color --no-prefix ${shellQuote(beforeFile)} ${shellQuote(afterFile)}`,
      cwd,
    );
    if (result.code >= 2) {
      throw new Error(`git diff failed (exit ${result.code}): ${result.stderr}`);
    }
    return result.stdout || `(no changes to ${label})`;
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

function tailLines(text: string, max: number): string {
  const lines = text.split("\n");
  if (lines.length <= max) return text;
  return `(... ${lines.length - max} earlier lines omitted)\n${lines.slice(-max).join("\n")}`;
}

function formatValidateSummary(validateOutput: string): string {
  return `pnpm validate passed. Output (last 40 lines):\n\n${tailLines(validateOutput, 40)}`;
}

function formatPlan(version: string, hasChanges: boolean): string {
  const lines: string[] = ["This will:"];
  if (hasChanges) {
    lines.push(`  git add ${RELEASE_FILES.join(" ")}`);
    lines.push(`  git commit -m "Release v${version}"`);
  } else {
    lines.push(`  # no pre-existing changes to commit`);
  }
  lines.push(`  git tag -a v${version} -m "Release v${version}"`);
  lines.push(`  git push origin main v${version}  (triggers .github/workflows/release.yml -> npm publish + GitHub release)`);
  lines.push("");
  lines.push(`After push, watch: ${WORKFLOW_RUN_URL}?query=tag%3Av${version}`);
  return lines.join("\n");
}

export default function releaseExtension(pi: ExtensionAPI): void {
  pi.registerCommand("release", {
    description: "Validate, tag, and push a release for the raindrop-cli package",
    getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
      const trimmed = prefix.trim();
      // Suggest the --yes flag when the user is typing a flag.
      if (trimmed === "" || trimmed === "-" || trimmed === "--" || trimmed === "-y" || trimmed.startsWith("--y")) {
        return [{ value: "--yes", label: "Skip all confirmations" }];
      }
      // Otherwise suggest the next patch version.
      const cwd = process.cwd();
      let state: CurrentState;
      try {
        state = readCurrentState(cwd);
      } catch {
        return null;
      }
      let suggested: string;
      try {
        suggested = suggestNextPatchVersion(state.currentVersion);
      } catch {
        return null;
      }
      if (suggested.startsWith(trimmed)) {
        return [{ value: suggested, label: `${suggested} (next patch)` }];
      }
      return null;
    },
    handler: async (args, ctx) => {
      let snapshots: FileSnapshot[] | undefined;
      try {
        const cwd = process.cwd();
        const { version: requestedVersion, yes } = parseArgs(args);
        const state = readCurrentState(cwd);

        // === Resolve the target version ===
        let version = requestedVersion;
        if (!version) {
          const suggested = suggestNextPatchVersion(state.currentVersion);
          if (yes) {
            version = suggested;
          } else {
            const input = await ctx.ui.input("Release version?", suggested);
            if (input === undefined) {
              ctx.ui.notify("Release cancelled.", "info");
              return;
            }
            const trimmed = input.trim();
            if (trimmed === "") {
              ctx.ui.notify("Release cancelled.", "info");
              return;
            }
            if (!isSemver(trimmed)) {
              throw new Error(`Invalid semver version: ${trimmed}. Expected format: X.Y.Z (optionally with -prerelease or +build).`);
            }
            version = trimmed;
          }
        }

        // === Snapshot before any mutation ===
        snapshots = snapshotFiles([
          join(cwd, "package.json"),
          state.changelogPath,
          ...RELEASE_FILES.map((file) => join(cwd, file)),
        ]);

        // === Pre-flight checks (no mutation yet) ===
        const branch = (await run("git branch --show-current", cwd)).stdout.trim();
        if (branch !== "main") {
          throw new Error(`Releases must be run from main. Current branch: ${branch || "detached HEAD"}`);
        }
        const tag = `v${version}`;
        const existingTag = (await run(`git tag --list ${shellQuote(tag)}`, cwd)).stdout.trim();
        if (existingTag) {
          throw new Error(`Tag already exists: ${tag}`);
        }
        const statusOutput = (await run("git status --short", cwd)).stdout;
        const { hasChanges } = ensureCleanForRelease(parseGitStatus(statusOutput));

        // === Step 1: Propose & review ===
        const today = new Date().toISOString().slice(0, 10);
        const currentPkg = readFileSync(join(cwd, "package.json"), "utf8");
        const currentCl = readFileSync(state.changelogPath, "utf8");

        const draft = draftChangelogSection(currentCl, state.hasUnreleased, version, today);

        let editedSection = draft;
        if (!yes) {
          const result = await ctx.ui.editor(
            `Release v${version} — review or edit the new CHANGELOG entry. Save and quit to accept; quit without saving to cancel.`,
            draft,
          );
          if (result === undefined) {
            ctx.ui.notify("Release cancelled.", "info");
            return;
          }
          editedSection = result;
        }

        // Compute the "after" state for diff display (reflects user's edits).
        const afterPkg = applyPackageJsonVersionEdit(currentPkg, version);
        let afterCl = applyChangelogEdit(currentCl, state.hasUnreleased, editedSection);
        if (state.hasFooter) {
          afterCl = updateChangelogFooter(afterCl, version);
        }

        if (!yes) {
          const pkgDiff = await generateUnifiedDiff(currentPkg, afterPkg, "package.json", cwd);
          const clDiff = await generateUnifiedDiff(currentCl, afterCl, "CHANGELOG.md", cwd);
          const diffText = tailLines(
            `--- package.json ---\n${pkgDiff}\n\n--- CHANGELOG.md ---\n${clDiff}`,
            DIFF_LINE_LIMIT,
          );
          const confirmed = await ctx.ui.confirm(
            "Apply these changes?",
            `${diffText}\n\nApply?`,
          );
          if (!confirmed) {
            ctx.ui.notify("Release cancelled.", "info");
            return;
          }
        }

        // === Step 2: Apply & validate ===
        applyRelease(cwd, state, version, editedSection);
        await run("pnpm codegen", cwd);
        const validateResult = await runTolerant("pnpm validate", cwd);
        if (validateResult.code !== 0) {
          const tail = tailLines(validateResult.stdout + validateResult.stderr, 40);
          throw new Error(
            `pnpm validate failed (exit ${validateResult.code}). Files will be restored.\n\n${tail}`,
          );
        }

        if (!yes) {
          const summary = `${formatValidateSummary(validateResult.stdout + validateResult.stderr)}\n\nFiles that will be committed:\n${RELEASE_FILES.map((f) => `  - ${f}`).join("\n")}\n\nContinue to commit, tag, and push?`;
          const confirmed = await ctx.ui.confirm("Everything green. Continue?", summary);
          if (!confirmed) {
            if (snapshots) restoreFiles(snapshots);
            ctx.ui.notify("Release cancelled; files restored.", "info");
            return;
          }
        }

        // === Step 3: Commit, tag, push ===
        if (!yes) {
          const plan = formatPlan(version, hasChanges);
          const confirmed = await ctx.ui.confirm("Commit, tag, and push?", `${plan}\n\nProceed?`);
          if (!confirmed) {
            if (snapshots) restoreFiles(snapshots);
            ctx.ui.notify("Release cancelled; files restored.", "info");
            return;
          }
        }

        if (hasChanges) {
          await run(`git add ${RELEASE_FILES.join(" ")}`, cwd);
          await run(`git commit -m ${shellQuote(`Release v${version}`)}`, cwd);
        }
        await run(`git tag -a ${shellQuote(tag)} -m ${shellQuote(`Release v${version}`)}`, cwd);
        await run(`git push origin main ${shellQuote(tag)}`, cwd);

        ctx.ui.notify(
          `Released v${version}. Watch the publish at ${WORKFLOW_RUN_URL}?query=tag%3Av${version}`,
          "info",
        );
      } catch (error) {
        if (snapshots) restoreFiles(snapshots);
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(message, "error");
      }
    },
  });
}
