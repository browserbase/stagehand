---
"browse": patch
---

Add Browserbase Search API filtering and content options to `browse cloud search`:

- `--include-domains` / `--exclude-domains`: restrict or block domains (hostname, path prefix, or wildcard)
- `--start-published-date` / `--end-published-date`: filter by publication date (ISO 8601)
- `--category`: focus on content category (Exa only)
- `--user-location`: two-letter country code to localize ranking
- `--moderation`: filter unsafe content (Exa only)
- `--objective`: natural-language task intent to add context to the query
- `--max-age-hours`: refetch cached pages older than this many hours
- `--excerpts`: return most relevant passages from each result

Provider/mode support expanded: Exa now supports `deep-lite` and `deep` modes. Response includes `provider` and `mode` fields showing which served the request.

Validation enforces API constraints: Parallel provider limits (200 domains, include/exclude mutual exclusion, supported country codes), domain format checks (no scheme, port, query string, or fragment).
