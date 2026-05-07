# Troubleshooting

Start with the built-in diagnostic command:

```bash
raindrop doctor
```

Use `--debug` only when you need more detail. Debug output is redacted, but you should still review it before sharing publicly.

## `auth_missing`

The CLI could not find a usable token.

Fix locally:

```bash
printf '%s' "$RAINDROP_ACCESS_TOKEN" | raindrop auth login --token-stdin
raindrop auth status
```

Fix in CI:

```bash
RAINDROP_ACCESS_TOKEN=... raindrop user get
```

See [auth.md](auth.md) for precedence rules.

## Invalid or expired token

Symptoms include authentication errors, authorization failures, or a failed `raindrop user get`.

Try:

```bash
raindrop auth status
raindrop auth refresh
raindrop user get
```

If refresh is not available or fails, create a new token in Raindrop.io and log in again:

```bash
printf '%s' "$NEW_RAINDROP_ACCESS_TOKEN" | raindrop auth login --token-stdin
```

## Credentials file permissions

On POSIX systems, credentials should be owner-only. Diagnose and repair:

```bash
raindrop doctor
raindrop doctor --fix-permissions
```

## Rate limits

Raindrop.io limits API requests per authenticated user. When rate-limited, the CLI exits with code `4` and includes rate-limit details when available.

Recommended responses:

- reduce concurrency
- add backoff in scripts
- use smaller batches
- retry later after the reset time

## Usage or validation errors

Usage errors exit with code `2` and include structured details on stderr. Run the command with `--help`:

```bash
raindrop bookmark add --help
raindrop collection create --help
```

## Network or API errors

Network, file, and protocol errors exit with code `1`.

Check:

```bash
raindrop doctor
raindrop doctor --debug
```

If you are testing against a mock server, verify `--base-url` points at the expected endpoint.

## Partial bulk success

Explicit bulk operations may partially succeed. These return exit code `6` and include structured details.

Scripts should handle code `6` separately from full success and full failure.

## Human output missing fields

Machine JSON preserves Raindrop API fields. Human output intentionally reads only stable common fields. If you need all data, omit `--human` and parse JSON.

## Command not found

Check the install:

```bash
raindrop --version
which raindrop
```

Run without installing:

```bash
npx @mocito/raindrop-cli --help
pnpm dlx @mocito/raindrop-cli --help
bunx @mocito/raindrop-cli --help
```

## Reporting bugs

When filing an issue, include:

- CLI version from `raindrop --version`
- Node.js version from `node --version`
- operating system
- command run, with secrets removed
- JSON error output, with secrets removed
- whether `raindrop doctor` passes

Never include live tokens, refresh tokens, client secrets, or Authorization headers.
