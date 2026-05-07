# Repository Agent Guidance

- Use pnpm for package management and scripts.
- Do not add `rd` or `raindrop-cli` binaries; expose only `raindrop`.
- JSON stdout is the contract; errors must be structured JSON on stderr.
- Never print or snapshot access tokens, refresh tokens, client secrets, or Authorization headers.
- Tests must use mocks or local helpers and must not require live Raindrop credentials.
