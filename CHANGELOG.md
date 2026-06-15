# Changelog

All notable changes to this project will be documented in this file.

This project aims to follow [Semantic Versioning](https://semver.org/). Breaking changes include incompatible changes to command names, required arguments, JSON output contracts, structured error envelopes, stable exit codes, or safety behavior such as `--force` requirements.

## [0.2.4] - 2026-06-15

### Security

- Closed a prototype-pollution gap: profile names matching reserved `Object.prototype` keys (`__proto__`, `prototype`, `constructor`) are now rejected by `safeProfileName` with the `invalid_profile` error code and `Usage` exit code.
- Routed all dynamic-key reads, writes, and deletes on the credentials, profiles, and config maps through centralized wrappers (`src/core/profiles-map.ts`, `src/core/safe-io.ts`) so user-controlled keys can no longer reach the prototype chain.
- Replaced the regex-based principal parser in `assertWindowsOwnerOnly` with a linear scan (`extractIcaclsPrincipal`) and swapped the `:(` anchor check for `indexOf(":(")` to drop a `safe-regex` complexity warning.
- Force-patched `esbuild` to `>=0.28.1` via `pnpm-workspace.yaml` `overrides` to close the open Deno RCE and Windows dev-server file-read advisories across all transitive consumers (`vitest`, `tsx`, etc.).
- Moved the build-script allowlist from `package.json`'s `pnpm.onlyBuiltDependencies` to `pnpm-workspace.yaml`'s `allowBuilds` (with `strictDepBuilds: false`); `esbuild` and `lefthook` are still allowed to run install-time build scripts, but the list is now explicit at the workspace level rather than per-package.
- New `.github/workflows/security.yml` (reusable workflow, also called by `release.yml`): `npm audit --omit=dev --audit-level=high` on production deps; `betterleaks` 1.5.0 (SARIF uploaded to Code Scanning) on every push to `main`, on PRs that touch `src/**`, `package.json`, `pnpm-lock.yaml`, or `.github/workflows/**`, and on a weekly schedule; `shellcheck` on `*.sh`; and `actionlint` + `zizmor` (high severity, medium confidence) on `.github/workflows/`. Replaces the old `gitleaks` step in `ci.yml`.
- New `.github/workflows/codeql.yml`: CodeQL JavaScript/TypeScript analysis on push to `main`, on PRs to `main`, and weekly.
- `ci.yml` now runs `pnpm audit --audit-level=high` (was `--audit-level moderate`) after build, on a Node 24 / 26 matrix.

### Changed

- Bumped the supported Node.js runtime from `>=20.11` to `>=24`. Older Node versions are no longer supported; upgrade to Node 24+ before updating.
- Replaced the `tsup` build pipeline with `tsc` (NodeNext ESM). The published `dist/` layout and the `raindrop` binary entry point are unchanged.
- Stack: pnpm 11.6, TypeScript 6, ESLint 10, Vitest 4, Prettier 3.8, `lefthook`, plus `eslint-plugin-security`, `safe-regex`, and `betterleaks` in the dev toolchain. A new `pnpm validate` runs lint + format:check + typecheck + test + build + audit end-to-end.
- Runtime dependencies: `commander` 14 → 15, `smol-toml` 1.4 → 1.6, `zod` 4.1 → 4.4. No public CLI contract changes.

### Internal

- Extracted the OAuth login completion flow into a `completeOAuthLogin` helper in `src/cli.ts`.
- Shared the `commands.yaml` parser between `codegen` and `spec-lint` via a new `scripts/lib/parse-commands-yaml.ts`.
- Added a `runCli` test helper and a `globalSetup` that isolates `RAINDROP_CONFIG_DIR` per test file.

## [0.2.3] - 2026-05-10

### Fixed

- Disabled install telemetry automatically in CI environments.

## [0.2.1] - 2026-05-10

### Added

- Added best-effort install/update telemetry with `RAINDROP_TELEMETRY=0` opt-out.

## [0.2.0] - 2026-05-07

### Added

- Added a `skills.sh` and Agent Skills-compatible `raindrop-cli` skill under `skills/raindrop-cli`.

### Fixed

- Updated the Homebrew formula to depend on the current `node` formula instead of forcing `node@20`.

## [0.1.1] - 2026-05-07

### Fixed

- Fixed CLI startup when installed through package-manager symlinks such as Homebrew and npm global bins.

## [0.1.0] - 2026-05-06

### Added

- Initial Raindrop.io CLI package with `raindrop` binary.
- JSON stdout by default and structured JSON errors on stderr.
- Authentication, profile, config, user, collection, bookmark, tag, highlight, import, export, backup, jobs, feedback, doctor, agent-context, raw API, completion, and update command surfaces.
- Safety guard requiring `--force` for destructive operations.
- Mock-based test suite and CI workflows.
