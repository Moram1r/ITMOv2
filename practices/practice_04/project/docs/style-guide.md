# Style Guide (Regex Tester API)

1) Validate through the public boundary first.
- Enforce size limits before touching the regex engine or parsing flags.

2) Honor status codes and limits from the contract.
- 400 for invalid flags/empty pattern; 413 for oversize; 504 for engine timeout.

3) Keep the runner honest.
- Do not weaken scripts/check.sh; tests must reflect real behavior.

4) Cap work and avoid traps.
- Return only the first `limit` matches; guard against zero-width infinite loops.

5) Tests first, then code.
- Use TDD: write failing tests, then implement minimal code.
