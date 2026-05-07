# Authentication

`raindrop` supports token-based authentication for local shells, scripts, CI, and agent workflows.

## Get a Raindrop token

Create or copy an access token from your Raindrop.io developer settings. Treat the token like a password.

Do not paste tokens into:

- GitHub issues or discussions
- test fixtures or snapshots
- shell history when avoidable
- CI logs
- screenshots or terminal recordings

## Recommended local login

Pass the token on stdin so it is not visible in process arguments:

```bash
printf '%s' "$RAINDROP_ACCESS_TOKEN" | raindrop auth login --token-stdin
raindrop auth status
raindrop user get
```

You can also pass a token directly for local testing, but stdin is preferred:

```bash
raindrop auth login --token <test-token>
```

## Environment-only authentication

For CI, containers, and short-lived automation, prefer the environment variable and avoid writing credentials to disk:

```bash
RAINDROP_ACCESS_TOKEN=... raindrop user get
```

`RAINDROP_ACCESS_TOKEN` has the highest authentication precedence.

## OAuth login

If you have OAuth app credentials, the CLI can store OAuth credentials for a profile:

```bash
raindrop auth login \
  --client-id <id> \
  --client-secret <secret> \
  --redirect-uri http://127.0.0.1:53682/callback
```

Refresh manually when needed:

```bash
raindrop auth refresh
```

The CLI also supports automatic refresh paths for stored OAuth credentials when the API reports an expired token.

## Credential storage

Stored credentials live under the Raindrop config directory:

```bash
raindrop config path
```

On POSIX systems, the CLI stores credentials in:

```text
~/.config/raindrop/credentials.json
```

The credentials file is expected to have owner-only permissions. Check and repair local state with:

```bash
raindrop doctor
raindrop doctor --fix-permissions
```

## Profiles

Profiles let you keep separate defaults and credentials:

```bash
raindrop profile save work --default-collection 123456 --output json
raindrop profile use work
raindrop profile get work
raindrop --profile work bookmark list --collection 0 --limit 10
```

Delete a profile explicitly:

```bash
raindrop profile delete work --force
```

## Authentication precedence

Authentication is resolved in this order:

1. `RAINDROP_ACCESS_TOKEN`
2. selected profile credentials
3. default profile credentials

Runtime configuration follows the broader precedence documented in [design.md](design.md): explicit flags, environment variables, active profile defaults, config file, then built-in defaults.

## Logout

Remove stored credentials for the selected profile:

```bash
raindrop auth logout --force
```

This does not revoke the token at Raindrop.io. Revoke or rotate tokens in Raindrop.io developer settings if a credential may have been exposed.
