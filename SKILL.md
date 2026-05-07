---
name: raindrop-cli
description: Use the `raindrop` CLI to operate Raindrop.io bookmarks, collections, tags, exports, profiles, and raw API requests.
---

# Raindrop CLI

- Default stdout is JSON. Use `--human` for tables.
- Errors are structured JSON on stderr.
- Authenticate with `RAINDROP_ACCESS_TOKEN` or `raindrop auth login --token-stdin`.
- Destructive operations require `--force`.

Common commands:

```bash
raindrop user get
raindrop bookmark add https://example.com --tag example
raindrop bookmark list --collection 0 --limit 50
raindrop collection list
raindrop export bookmarks 0 csv --output bookmarks.csv
raindrop api request GET /user
raindrop agent-context
```
