# Raindrop CLI

Agent-friendly and script-friendly CLI for [Raindrop.io](https://raindrop.io). The binary is `raindrop`, stdout is JSON by default, and CLI-rendered errors are structured JSON on stderr.

## Why this CLI?

`raindrop` is designed for automation first:

- JSON stdout by default for reliable scripting and agent use
- structured JSON errors on stderr with stable exit codes
- bounded list operations; no hidden full-account pagination
- destructive operations require `--force`
- credentials and authorization headers are redacted from debug paths
- `agent-context` exposes machine-readable command metadata
- raw API escape hatch with `raindrop api request`

## Installation

Requires Node.js `>=20.11`.

```bash
npm install -g @mocito/raindrop-cli
pnpm add -g @mocito/raindrop-cli
bun add -g @mocito/raindrop-cli
```

With Homebrew:

```bash
brew tap jvm/tap
brew install raindrop-cli
```

Run without installing:

```bash
npx @mocito/raindrop-cli --help
pnpm dlx @mocito/raindrop-cli --help
bunx @mocito/raindrop-cli --help
```

As a project dev dependency:

```bash
npm install -D @mocito/raindrop-cli
pnpm add -D @mocito/raindrop-cli
bun add -d @mocito/raindrop-cli
```

## Quickstart

```bash
printf '%s' "$RAINDROP_ACCESS_TOKEN" | raindrop auth login --token-stdin
raindrop user get
raindrop bookmark add https://developer.raindrop.io --tag api --tag docs
raindrop bookmark list --collection 0 --limit 50
raindrop collection list --human
raindrop export bookmarks 0 csv --output bookmarks.csv
```

## Authentication

For local use, store a token securely:

```bash
printf '%s' "$RAINDROP_ACCESS_TOKEN" | raindrop auth login --token-stdin
raindrop auth status
```

For CI and ephemeral environments, avoid writing credentials to disk and pass the token as an environment variable:

```bash
RAINDROP_ACCESS_TOKEN=... raindrop user get
```

See [docs/auth.md](docs/auth.md) for token setup, credential paths, precedence, and OAuth notes.

## Common workflows

```bash
# Search bookmarks and print titles with jq
raindrop bookmark search "tag:api" --collection 0 --limit 10 | jq -r '.items[].title'

# Add a bookmark to a collection
raindrop bookmark add https://example.com --collection 42 --tag reference

# Export all non-trash bookmarks to CSV
raindrop export bookmarks 0 csv --output bookmarks.csv

# Diagnose local config, auth, and API connectivity
raindrop doctor
```

More examples are in [docs/examples.md](docs/examples.md).

## Output contract

Success output is JSON by default. Human output is opt-in with `--human` where available.

Errors are structured JSON on stderr:

```json
{
  "error": {
    "code": "auth_missing",
    "message": "No Raindrop.io access token configured",
    "hint": "Run: raindrop auth login --token-stdin, or set RAINDROP_ACCESS_TOKEN",
    "status": 401
  }
}
```

See [docs/output.md](docs/output.md) for the full stdout/stderr contract and stable exit codes.

## Documentation

- [Authentication](docs/auth.md)
- [Command reference](docs/commands.md)
- [Examples](docs/examples.md)
- [Output and error contract](docs/output.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Design notes](docs/design.md)
- [Agent context schema](docs/agent-context.schema.json)
- [Security policy](SECURITY.md)
- [Contributing](CONTRIBUTING.md)
- [Changelog](CHANGELOG.md)

## Development

This repository uses pnpm.

```bash
pnpm install
pnpm build
pnpm test
pnpm lint
pnpm format
pnpm typecheck
pnpm verify-pack
```

Generated command docs and specs come from `spec/commands.yaml`:

```bash
pnpm codegen
```

Tests must use mocks or local helpers and must not require live Raindrop credentials.

## Security

Never include live Raindrop access tokens, refresh tokens, client secrets, or Authorization headers in issues, logs, tests, or snapshots. Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## License

MIT. See [LICENSE](LICENSE).
