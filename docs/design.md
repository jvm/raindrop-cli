# Design

The CLI follows the implementation plan in `PLAN.md`.

## Contracts

- Stdout is JSON by default.
- CLI-rendered errors are structured JSON on stderr.
- Human output is opt-in with `--human`.
- Destructive operations require `--force`.
- List operations are bounded by `--page` and `--limit`; no hidden full-account pagination is performed.
- `--output` is sugar for `--deliver=file:<path>` and is mutually exclusive with `--deliver`.

## Auth precedence

1. `RAINDROP_ACCESS_TOKEN`
2. Selected profile credentials
3. Default profile credentials

## Runtime precedence

1. Explicit flags
2. Environment variables
3. Active profile defaults
4. Config file
5. Built-in defaults

## API mapping

The CLI uses Raindrop.io REST endpoints under `https://api.raindrop.io/rest/v1` and preserves raw JSON fields in machine output. Human output reads only stable common fields.
