# Output and Error Contract

## Success stdout

Default stdout is JSON. Human output is opt-in with `--human` where available.

Single-object responses preserve the Raindrop API response shape. Bounded list commands add pagination metadata where possible:

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

## Errors stderr

CLI-rendered errors are JSON on stderr:

```json
{
  "error": {
    "code": "auth_missing",
    "message": "No Raindrop.io access token configured",
    "hint": "Run: raindrop auth login --token-stdin, or set RAINDROP_ACCESS_TOKEN",
    "status": 401
  }
}
```

Optional error fields include `request_id`, `status`, `valid_values`, `usage`, `details`, and `rate_limit`.

## Exit codes

| Code | Meaning                                    |
| ---: | ------------------------------------------ |
|    0 | Success                                    |
|    1 | API/network/file/protocol error            |
|    2 | Usage/validation error                     |
|    3 | Authentication/authorization error         |
|    4 | Rate-limited or retry budget exhausted     |
|    5 | Wait timeout                               |
|    6 | Partial success in explicit bulk operation |
