# Examples

These examples assume you have authenticated with either `RAINDROP_ACCESS_TOKEN` or `raindrop auth login --token-stdin`. See [auth.md](auth.md).

## Check status

```bash
raindrop auth status
raindrop user get
raindrop doctor
```

Representative JSON success output:

```json
{
  "result": true,
  "user": {
    "_id": 123,
    "email": "user@example.com"
  }
}
```

## Add bookmarks

```bash
raindrop bookmark add https://developer.raindrop.io --tag api --tag docs
raindrop bookmark add https://example.com --collection 42 --important
raindrop bookmark create -d '{"link":"https://example.com","title":"Example"}'
```

Allow duplicates only when that is intentional:

```bash
raindrop bookmark add https://example.com --allow-duplicate
```

## Search and list bookmarks

```bash
raindrop bookmark list --collection 0 --limit 50
raindrop bookmark list --collection 0 --sort -created --search "tag:api"
raindrop bookmark search "tag:api type:article" --collection 0
```

Use `jq` in scripts:

```bash
raindrop bookmark search "tag:api" --collection 0 --limit 10 | jq -r '.items[].title'
```

List output is bounded and includes pagination metadata where possible:

```json
{
  "result": true,
  "items": [],
  "page": 0,
  "perpage": 50,
  "count": 0,
  "truncated": false
}
```

## Update and delete bookmarks

```bash
raindrop bookmark update 123 --title "New Title" --tag archived
raindrop bookmark delete 123 --force
```

Destructive operations require `--force` so automation cannot delete data by accident.

## Collections

```bash
raindrop collection list --human
raindrop collection tree --human
raindrop collection get 123
raindrop collection create --title "Reading List" --view list
raindrop collection update 123 --title "New Title" --public=false
raindrop collection delete 123 --force
```

Raindrop system collection IDs commonly used by the API:

- `0`: all bookmarks except Trash
- `-1`: Unsorted
- `-99`: Trash

## Tags

```bash
raindrop tag list --collection 0
raindrop tag rename old-name new-name
raindrop tag merge api docs --to reference
raindrop tag delete unused-tag --force
```

## Highlights

```bash
raindrop highlight list --collection 0
raindrop highlight add 123 --text "Important quote"
raindrop highlight update 456 --text "Updated quote"
raindrop highlight delete 123 456 --force
```

## Export and backup

```bash
raindrop export bookmarks 0 csv --output bookmarks.csv
raindrop export bookmarks 0 html --output bookmarks.html
raindrop backup generate --wait
raindrop backup list
raindrop backup download <backup-id> --output raindrop-backup.zip
```

## Profiles

```bash
raindrop profile save work --default-collection 123456 --output json
raindrop profile use work
raindrop --profile work bookmark list --collection 0 --limit 10
```

## Raw API escape hatch

Use `api request` for endpoints that do not yet have first-class commands:

```bash
raindrop api request GET /user
raindrop api request POST /raindrop -d '{"link":"https://example.com"}'
```

## CI usage

Use environment-only authentication in CI:

```bash
RAINDROP_ACCESS_TOKEN="$RAINDROP_ACCESS_TOKEN" raindrop bookmark list --collection 0 --limit 10
```

Never print tokens, refresh tokens, client secrets, or Authorization headers in logs.

## Agent usage

Agents can inspect the CLI contract:

```bash
raindrop agent-context
raindrop agent-context --command bookmark.add
```

The stable automation assumptions are:

- success data is written to stdout as JSON by default
- CLI-rendered errors are written to stderr as JSON
- exit codes are stable; see [output.md](output.md)
- list commands are bounded by explicit page/limit options
- destructive operations require `--force`
