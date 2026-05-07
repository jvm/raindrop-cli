---
name: raindrop-cli
description: Use the `raindrop` CLI to manage Raindrop.io bookmarks, collections, tags, highlights, imports, exports, backups, profiles, and raw API calls. Use this skill whenever a user asks to search, add, edit, deduplicate, export, import, back up, organize, or inspect Raindrop.io data from the terminal or in automation.
license: MIT
compatibility: Requires the `raindrop` binary from @mocito/raindrop-cli, Node.js >=20.11, network access to Raindrop.io, and a Raindrop.io access token or configured profile.
---

# Raindrop CLI

Use `raindrop` for agent-friendly Raindrop.io automation. It prints JSON on stdout by default and structured JSON errors on stderr, so prefer machine-readable flows over screen scraping.

## Operating rules

1. Prefer JSON output. Do not use `--human` unless the user specifically wants a table or other human-readable output.
2. Never print, log, snapshot, or paste access tokens, refresh tokens, client secrets, or Authorization headers.
3. For CI, containers, and other ephemeral environments, prefer `RAINDROP_ACCESS_TOKEN=... raindrop ...` over writing credentials to disk.
4. For local persistent auth, pass tokens through stdin so they are not exposed in process arguments:

   ```bash
   printf '%s' "$RAINDROP_ACCESS_TOKEN" | raindrop auth login --token-stdin
   ```

5. Destructive commands require `--force`. Confirm user intent before deleting, bulk-updating, emptying trash, clearing feedback, deleting profiles, or removing collaborators.
6. List and search commands are bounded. Respect `--limit`, pagination fields, and `truncated`; do not perform hidden full-account scans unless the user explicitly asks.
7. Parse JSON with `jq` or programmatic JSON parsing rather than regex.
8. If a command fails, inspect structured stderr fields such as `error.code`, `message`, `hint`, `status`, `valid_values`, and `rate_limit`.

## First steps

Check that the CLI is available and understand its machine-readable capabilities:

```bash
raindrop --version
raindrop agent-context
raindrop auth status
```

Use `raindrop agent-context` when you need current command metadata instead of relying on memory.

## Common workflows

### Get current user

```bash
raindrop user get
```

### Search bookmarks

```bash
raindrop bookmark search "tag:api" --collection 0 --limit 20
```

### Add a bookmark

```bash
raindrop bookmark add https://example.com --tag reference
```

### Check whether URLs already exist

```bash
raindrop import exists https://example.com https://developer.raindrop.io
```

### List collections

```bash
raindrop collection list
raindrop collection tree
```

### Export bookmarks

```bash
raindrop export bookmarks 0 csv --output bookmarks.csv
```

### Use the raw API escape hatch

Use `raindrop api request` only when no dedicated CLI command exists:

```bash
raindrop api request GET /user
```

## Troubleshooting

Run diagnostics before guessing about config, auth, network, or path issues:

```bash
raindrop doctor
```

Exit codes:

- `0`: success
- `1`: API, network, file, or protocol error
- `2`: usage or validation error
- `3`: authentication or authorization error
- `4`: rate-limited or retry budget exhausted
- `5`: wait timeout
- `6`: partial success in an explicit bulk operation

## References

Read these only when the task needs more detail:

- [Command reference](references/commands.md) for command syntax and examples.
- [Output contract](references/output.md) for stdout, stderr, and exit codes.
- [Authentication guide](references/auth.md) for credential storage, profiles, and token precedence.
