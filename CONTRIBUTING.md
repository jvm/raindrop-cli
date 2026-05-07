# Contributing

Thanks for helping improve Raindrop CLI.

## Development setup

This project uses pnpm and Node.js `>=20.11`.

```bash
pnpm install
pnpm build
pnpm test
```

Useful checks:

```bash
pnpm lint
pnpm format
pnpm typecheck
pnpm test
pnpm verify-pack
```

## Generated files

Command specs and command docs are generated from `spec/commands.yaml`:

```bash
pnpm codegen
```

Do not hand-edit generated files unless you are intentionally changing the generator:

- `src/generated/command-specs.ts`
- `docs/commands.md`

## Tests

Tests must use mocks or local helpers and must not require live Raindrop credentials.

Do not add live tokens, refresh tokens, client secrets, Authorization headers, or other secrets to fixtures, snapshots, examples, or logs.

## CLI contracts to preserve

Public changes should preserve these contracts unless the change is intentionally breaking:

- default stdout is JSON
- CLI-rendered errors are structured JSON on stderr
- exit codes are stable
- destructive operations require `--force`
- list operations are bounded and do not secretly paginate whole accounts
- human output is opt-in with `--human`
- only the `raindrop` binary is exposed

## Pull requests

Before opening a PR, run:

```bash
pnpm lint
pnpm format
pnpm typecheck
pnpm test
pnpm build
pnpm verify-pack
```

For command changes, update `spec/commands.yaml`, run `pnpm codegen`, and include docs/examples updates where useful.

## Security issues

Please do not report vulnerabilities in public issues. See [SECURITY.md](SECURITY.md).
