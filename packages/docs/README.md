# Stagehand docs

This site contains the Stagehand v2, v3, and v4 documentation. V4 is the default version.

## Local development

From the repository root:

```sh
just install
just docs
```

`just docs` starts the repository-pinned Mint development server. No globally installed Mint or
Mintlify CLI is required.

## Validation

From the repository root:

```sh
just check
```

This validates the Mint configuration and OpenAPI definitions, checks links and redirects, and runs
the documentation accessibility checks.

## V3 API reference source

The v3 API reference uses the checked-in `v3/openapi.json`, not a live Stainless URL.
The former source,
`https://app.stainless.com/api/spec/documented/stagehand/openapi.documented.yml`,
returned HTTP 404 and prevented Mint validation from completing.

The snapshot was recovered on September 15, 2026 from the OpenAPI YAML blocks in the
published `https://docs.stagehand.dev/v3/api-reference/{language}/{page}.md` pages.
All 32 pages (eight endpoints each for Python, Java, Go, and Ruby) were compared.
Their common metadata, operations, and shared components agreed. The snapshot
combines those fragments without changing descriptions, schemas, authentication,
servers, or code samples: eight endpoints, 67 schemas, and two security schemes.
The four language sections retain their existing navigation and generated page paths.

Treat this as the versioned v3 documentation source. Future spec updates must be
reviewed as content changes, including endpoint titles/URLs, request and response
schemas, authentication, and code samples. Do not replace it with a different
server-generated spec just to make validation pass. Run the docs checks and
`pnpm --filter @browserbasehq/stagehand-docs test:unit` after updates.

## Publishing

Documentation is deployed through the Mintlify GitHub integration after changes reach the
repository's default branch.
