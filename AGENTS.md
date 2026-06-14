# Repository Agent Guidelines

This file is the single source of truth for agent (and human) conventions in
this repo. A common jvm-OSS standard applies to all six public Node repos
under `github.com/jvm`; the standard is reproduced below. **Per-repo notes
follow** the common corpus; per-repo notes never override the standard —
they add to it.

## Standard jvm-OSS conventions (applies to all repos)

### Stack

- **Runtime:** Node.js 24+ (tested on Node 24.x and Node 26.x in CI)
- **Package manager:** pnpm 11.x, pinned via `packageManager` in `package.json`
- **Module system:** ESM (`"type": "module"`)
- **Language:** TypeScript `^6.0` (current `latest`; matches `porkbun-cli`)
- **Test framework:** vitest (`pnpm test` = `vitest run`, `pnpm test:watch` = `vitest`)
- **Build:** `tsc` (run via `pnpm build`)
- **Lint:** ESLint 10 flat config (`pnpm lint` = `eslint .`)
- **Format:** Prettier (`pnpm format` = `prettier --write .`, `pnpm format:check` = `prettier --check .`)

### Dev commands

All commands use pnpm.

| Command                   | Purpose                                                             |
| ------------------------- | ------------------------------------------------------------------- |
| `pnpm install`            | Install deps (uses `pnpm-lock.yaml`)                                |
| `pnpm lint`               | Run ESLint                                                          |
| `pnpm format`             | Format with Prettier                                                |
| `pnpm format:check`       | Verify formatting (used in CI)                                      |
| `pnpm typecheck`          | `tsc --noEmit`                                                      |
| `pnpm test`               | Run vitest once                                                     |
| `pnpm test:watch`         | Run vitest in watch mode                                            |
| `pnpm build`              | Compile to `dist/` via `tsc`                                        |
| `pnpm audit`              | `npm audit --omit=dev --audit-level=high`                           |
| `pnpm verify-pack`        | `npm pack --dry-run`                                                |
| `pnpm validate`           | lint + format:check + typecheck + test + build + audit              |
| `pnpm security:secrets`   | betterleaks on the working tree (full scan)                         |
| `pnpm security:scripts`   | shellcheck on `*.sh` (skipped if shellcheck not on PATH)            |
| `pnpm security:workflows` | actionlint on `.github/workflows/*.yml` (skipped if not on PATH)    |
| `pnpm security:local`     | audit + secrets + scripts + workflows (opt-in, full local security) |

### Code style

- **Dynamic-key collections** use `Map<K, V>`, not `Record<K, V>`. ESLint's
  security plugin flags bracket writes/reads on plain objects.
- **Non-literal array indexing** uses `arr.at(i)`, not `arr[i]`.
- **Single dynamic property reads** on a plain object use `Reflect.get(obj, key)`.
- **`as any` is not allowed** unless wrapped in a one-line justification
  (`// eslint-disable-next-line @typescript-eslint/no-explicit-any — <why>`).
- **No blanket `eslint-disable` files.** Disables are per-line with a
  justification.
- ESM imports in `.ts` source use explicit `.js` extensions (e.g.,
  `import { foo } from "./bar.js"`), because `module: NodeNext` resolves
  them at build time.

### Security and CI

- **Local security layer:** `.lefthook.yml` enforces on every commit (betterleaks
  on staged files, prettier check, typecheck if TS files staged) and on every
  push (`pnpm validate`). `pnpm install` brings the `lefthook` binary in; the
  developer runs `pnpm exec lefthook install` once per clone to install the
  git hooks. CI is the source of truth; hooks are a fast feedback loop, not
  a guarantee.
- **Secret scan:** betterleaks on every PR and push (`security.yml`).
- **CodeQL:** weekly + on PRs that touch `src/**` (`security.yml`).
- **Dependency audit:** `npm audit --omit=dev --audit-level=high` on every
  PR (`ci.yml`). Use npm (not pnpm) for the registry talk so the
  vulnerability database is the authoritative source.
- **Trusted publishing (OIDC) for npm** — never commit an `NPM_TOKEN`
  secret.
- **All GitHub Actions are pinned by SHA**, with a comment showing the
  version (e.g., `# v6.0.2`). Update SHAs in a dedicated PR, not in
  feature PRs.
- **Dependabot** is enabled for both `npm` and `github-actions`
  ecosystems; minor/patch are auto-merged only after CI is green.
- **Branch protection** (set in repo settings, not in code) requires
  `ci` and `security` to pass.

### Commit and PR conventions

- Imperative-mood subject ("Add X", not "Added X").
- One logical change per commit. Multi-area changes split into multiple
  commits in one PR is OK; one commit with mixed concerns is not.
- Branch from `main`. Use descriptive branch names
  (`feat/...`, `fix/...`, `chore/...`, `docs/...`).
- No `--force` to shared branches. Force-with-lease is OK for feature
  branches you own.
- No unrelated file churn in a feature PR (e.g., don't reformat
  unrelated files).
- Run `pnpm validate` before opening a PR. CI re-runs it anyway;
  catching it locally saves a round-trip.

## Per-repo notes: raindrop-cli

### Purpose

Agent-friendly and script-friendly CLI for Raindrop.io.

### Key entry points

- `src/cli.ts` — command definitions and output contract
- `src/core/` — auth, config, request, output, and safety helpers
- `spec/commands.yaml` — source of truth for generated command docs/specs
- `scripts/codegen.ts` — regenerates `src/generated/command-specs.ts` and `docs/commands.md`
- `scripts/verify-pack.ts` — package contents and install smoke check
- `test/` — contract, integration, and redaction coverage

### Repository rules

- Use pnpm for package management and scripts.
- Do not add `rd` or `raindrop-cli` binaries; expose only `raindrop`.
- JSON stdout is the contract; errors must be structured JSON on stderr.
- Never print or snapshot access tokens, refresh tokens, client secrets, or Authorization headers.
- Tests must use mocks or local helpers and must not require live Raindrop credentials.
- Run `pnpm codegen` after editing `spec/commands.yaml`.
- The Homebrew formula in `formula/raindrop-cli.rb` is regenerated by `release.yml`; do not hand-edit it for tag releases.
