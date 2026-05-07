# Security Policy

Please report vulnerabilities privately to the repository owner. Do not include live Raindrop.io tokens in issues, logs, or test fixtures.

The CLI stores token credentials in `~/.config/raindrop/credentials.json` with owner-only permissions on POSIX systems. You can avoid disk storage in CI by setting `RAINDROP_ACCESS_TOKEN`.
