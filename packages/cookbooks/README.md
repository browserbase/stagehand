# Stagehand cookbooks

These runnable SDK cookbooks pair with pages in the [Cookbooks docs](https://docs.stagehand.dev/v4/cookbooks/overview). Clone one folder with sparse checkout:

```bash
git clone --depth 1 --sparse https://github.com/browserbase/stagehand.git
cd stagehand
git sparse-checkout set packages/cookbooks/<cookbook-name>
```

| Folder                                             | Languages              | Job                                                          |
| -------------------------------------------------- | ---------------------- | ------------------------------------------------------------ |
| [approve-form-submission](approve-form-submission) | TypeScript, Python, Go | Fill a form and require approval before submit               |
| [paginated-catalog](paginated-catalog)             | TypeScript, Python, Go | Export a complete book catalog across pages                  |
| [files-to-bucket](files-to-bucket)                 | TypeScript             | Extract book data and upload files with Files SDK            |
| [ai-sdk-research-agent](ai-sdk-research-agent)     | TypeScript             | Research two approved docs pages with typed source citations |
| [webmcp-smoke-test](webmcp-smoke-test)             | TypeScript, Python, Go | Invoke a tool registered by a real WebMCP page               |

Cloud browser jobs need `BROWSERBASE_API_KEY` and use `OPENAI_API_KEY` unless the paginated catalog sets `MODEL_PROVIDER=gateway`. WebMCP uses local Chromium without either key. SDK samples used by `just example` remain under the SDK packages.
