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

## Publishing

Documentation is deployed through the Mintlify GitHub integration after changes reach the
repository's default branch.
