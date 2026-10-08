# Stagehand cookbooks

Browser jobs you can run, adapt, and combine. Each has a [docs page](https://docs.stagehand.dev/v4/cookbooks/overview), source folder, and coding-agent prompt.

| Cookbook                                 | Languages              | Output                                      |
| ---------------------------------------- | ---------------------- | ------------------------------------------- |
| [Persisted login](persisted-login)       | TypeScript, Python, Go | Authentication and reuse receipt            |
| [Paginated catalog](paginated-catalog)   | TypeScript, Python, Go | Checkpoint and complete catalog             |
| [Files to bucket](files-to-bucket)       | TypeScript             | JSON and JPEG; optional S3 upload           |
| [Form approval](approve-form-submission) | TypeScript, Python, Go | Submission or rejection; TypeScript receipt |
| [Research agent](ai-sdk-research-agent)  | TypeScript             | Report citing approved sources              |

## Run

```bash
git clone --depth 1 --sparse https://github.com/browserbase/stagehand.git
cd stagehand
git sparse-checkout set packages/examples/cookbooks/<cookbook-name>
```

Follow the selected README. Each language folder has its own environment template and lockfile. Cloud jobs require `BROWSERBASE_API_KEY` and `OPENAI_API_KEY`, print a session link, and limit browser lifetime to five minutes. Page and step limits bound work, not cost.

From a full checkout, `just cookbook <slug>` runs an installed TypeScript cookbook. Recorded jobs live in [the showcase](https://stagehand.dev/showcase); their scripts use `just showcase-script <slug>`.\n

## Contribute

Include a docs page, agent prompt, README, environment template, lockfile, output checks, and cleanup. Core browser jobs support TypeScript, Python, and Go. Integration recipes may be TypeScript-only.

Run TypeScript typechecks and available unit tests, Python catalog tests, and Go tests. Live-test changed browser behavior locally. Keep context and checkpoint writes sequential.

Use Playwright locators for known elements, Stagehand for natural-language actions and extraction, and site-provided WebMCP tools when available. See [model configuration](https://docs.stagehand.dev/v4/configuration/models) and [Functions deployment](https://docs.stagehand.dev/v4/best-practices/deployments) for other setups.
