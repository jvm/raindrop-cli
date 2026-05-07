## Summary

<!-- What changed and why? -->

## Checklist

- [ ] Tests use mocks/local helpers and do not require live Raindrop credentials
- [ ] No tokens, refresh tokens, client secrets, or Authorization headers are printed or snapshotted
- [ ] JSON stdout / JSON stderr / exit-code contracts are preserved, or breaking changes are clearly called out
- [ ] Destructive operations still require `--force`
- [ ] Command changes were made in `spec/commands.yaml` and regenerated with `pnpm codegen`
- [ ] Docs/examples were updated where useful

## Verification

```bash
pnpm lint
pnpm format
pnpm typecheck
pnpm test
pnpm build
pnpm verify-pack
```
