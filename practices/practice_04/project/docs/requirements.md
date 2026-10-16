# Regex Tester API — Requirements

## Endpoint
- POST /regex/test
- Request body: { pattern: string, text: string, flags?: string, limit?: int, timeout_sec?: float }
- Success (200): { matches: [{ span: [start, end], groups: string[] }], count: number, meta: { timed_out: boolean, time_ms: number } }

## Feature A — Input validation
- If len(text) > 20000 or len(pattern) > 2000 → 413 Payload Too Large.
- On 413, the regex engine MUST NOT be called.
- Invalid flags → 400 Bad Request, with detail indicating the invalid flag.
- Empty pattern → 400 Bad Request.

## Feature B — Timeout of regex engine
- The search is limited by timeout_sec (default 1.5s, max 5.0s).
- If timeout exceeded → 504 Gateway Timeout, detail: "engine timeout", include timeout_sec.
- On success under timeout → 200 with first up-to limit matches (default cap 100).

## Constraints
- MAX_TEXT_LEN=20000, MAX_PATTERN_LEN=2000, MAX_MATCHES=100, DEFAULT_TIMEOUT_SEC=1.5, ABS_TIMEOUT_CEILING=5.0.
- Allowed flags: i, m, s, x, a, L, u.
- Return only first limit matches; protect against zero-width infinite loops.

## Error format
- 400: { detail: string | { detail: string } }
- 413: { detail: { detail: "payload too large" } }
- 504: { detail: { detail: "engine timeout", timeout_sec: number } }

## Test runner
- Run all checks with: sh scripts/check.sh
