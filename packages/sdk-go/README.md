<div id="toc" align="center" style="margin-bottom: 0;">
  <ul style="list-style: none; margin: 0; padding: 0;">
    <a href="https://stagehand.dev">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/browserbase/stagehand/main/media/dark_logo.png" />
        <img alt="Stagehand" src="https://raw.githubusercontent.com/browserbase/stagehand/main/media/light_logo.png" width="200" style="margin-right: 30px;" />
      </picture>
    </a>
  </ul>
</div>
<p align="center">
  <strong>Stagehand is the SDK for browser agents.</strong><br>
  <a href="https://docs.stagehand.dev">Read the Docs</a>
</p>

<p align="center">
  <a href="https://github.com/browserbase/stagehand/tree/main?tab=MIT-1-ov-file#MIT-1-ov-file">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/browserbase/stagehand/main/media/dark_license.svg" />
      <img alt="MIT License" src="https://raw.githubusercontent.com/browserbase/stagehand/main/media/light_license.svg" />
    </picture>
  </a>
  <a href="https://discord.gg/stagehand">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/browserbase/stagehand/main/media/dark_discord.svg" />
      <img alt="Discord Community" src="https://raw.githubusercontent.com/browserbase/stagehand/main/media/light_discord.svg" />
    </picture>
  </a>
</p>

<p align="center">
	<a href="https://trendshift.io/repositories/12122" target="_blank"><img src="https://trendshift.io/api/badge/repositories/12122" alt="browserbase%2Fstagehand | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>
</p>

<p align="center">
  <a href="https://deepwiki.com/browserbase/stagehand">
    <img alt="Ask DeepWiki" src="https://deepwiki.com/badge.svg" />
  </a>
</p>

# Stagehand Go SDK

## What is Stagehand?

Stagehand is the SDK for browser agents. Playwright was built for testing, Stagehand is built for agents. Use familiar APIs, self-healing actions, and network-level security across TypeScript, Python, and Go.

## Why Stagehand?

Stagehand gives browser agents an interface built for how they actually work. It combines familiar Playwright-style APIs with self-healing actions, agent-optimized page context, and native support for complex DOM structures like out-of-process iframes and closed Shadow DOMs.

Agents use fewer tokens, recover when websites change, and complete tasks more reliably. With a complete browser driver across TypeScript, Python, and Go, Stagehand delivers the flexibility of AI without sacrificing the speed, control, determinism, reliability, and observability required in production.

For the full overview, examples, and contributing guide, see the [main README](https://github.com/browserbase/stagehand/blob/main/README.md).

## Example

```go
package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"

	stagehand "github.com/browserbase/stagehand/packages/sdk-go"
)

type pullRequest struct {
	Author string `json:"author"`
	Title  string `json:"title"`
}

func main() {
	if err := run(context.Background()); err != nil {
		log.Fatal(err)
	}
}

func run(ctx context.Context) (err error) {
	browser, err := stagehand.LaunchLocalBrowser(ctx, &stagehand.LocalBrowserLaunchOptions{Headless: true})
	if err != nil {
		return err
	}
	defer func() { err = errors.Join(err, browser.Close(ctx)) }()

	modelAPIKey := os.Getenv("OPENAI_API_KEY")
	client, err := stagehand.Create(ctx, stagehand.CreateOptions{
		Browser: browser,
		Model: &stagehand.ModelConfig{
			ModelName: "openai/gpt-5.4-mini",
			APIKey:    &modelAPIKey,
		},
	})
	if err != nil {
		return err
	}
	defer func() { err = errors.Join(err, client.Close(ctx)) }()

	browserContext, err := browser.Context()
	if err != nil {
		return err
	}
	pages, err := browserContext.Pages(ctx)
	if err != nil {
		return err
	}
	page := pages[0]
	if _, err := page.Goto(ctx, "https://github.com/browserbase", nil); err != nil {
		return err
	}

	// Act executes individual actions
	if _, err := client.Act(ctx, stagehand.ActInstruction("click on the stagehand repo"), nil); err != nil {
		return err
	}

	// Observe reports what is actionable on the page
	instruction := "find the latest PR"
	observed, err := client.Observe(ctx, &instruction, nil)
	if err != nil {
		return err
	}

	// Locators give deterministic, Playwright-style actions
	if err := page.Locator(observed.Data[0].Selector).Click(ctx, nil); err != nil {
		return err
	}

	// Extract returns structured data decoded into a Go type
	extracted, err := stagehand.Extract[pullRequest](
		ctx,
		client,
		"extract the author and title of the PR",
		nil,
	)
	if err != nil {
		return err
	}
	fmt.Println(extracted.Data.Author, extracted.Data.Title)

	return nil
}
```

Browserbase Search and Fetch are also available without launching a browser:

```go
numResults := 5
results, err := stagehand.SearchBrowserbase(ctx, stagehand.BrowserbaseSearchOptions{
	APIKey: os.Getenv("BROWSERBASE_API_KEY"),
	Query: "browser agent frameworks",
	NumResults: &numResults,
})
if err != nil {
	return err
}
if len(results.Results) == 0 {
	return fmt.Errorf("search returned no results")
}
fetched, err := stagehand.FetchBrowserbase(ctx, stagehand.BrowserbaseFetchOptions{
	APIKey: os.Getenv("BROWSERBASE_API_KEY"),
	URL: results.Results[0].URL,
	Format: stagehand.BrowserbaseFetchFormatMarkdown,
})
if err != nil {
	return err
}
content, ok := fetched.Content.AsString()
if !ok {
	return fmt.Errorf("fetch returned non-string content")
}
fmt.Println(content)
```

## Navigation

Navigation methods return the main-document response when the browser performs a network request:

```go
response, err := page.Goto(ctx, "https://example.com", nil)
if err != nil {
	return err
}
if response != nil {
	body, err := response.Body(ctx)
	if err != nil {
		return err
	}
	fmt.Println(response.Status(), string(body))
}
```

`Reload`, `GoBack`, and `GoForward` use the same `(*Response, error)` pattern. A successful
navigation without a main-document network response returns `(nil, nil)`. Response bodies and
complete headers are retrieved lazily while the Stagehand session remains open.

## Extraction

Define the output as a Go type and call the package-level generic function. Stagehand derives the JSON Schema from the type and returns decoded data with the usual result metadata:

```go
type story struct {
	Title  string `json:"title"`
	Points int    `json:"points"`
}

type stories struct {
	Stories []story `json:"stories"`
}

result, err := stagehand.Extract[stories](ctx, sh, "Extract the top 5 stories", nil)
if err != nil {
	return err
}
fmt.Println(result.Data.Stories)
```

Fields omitted with `json:",omitempty"` are optional in the generated schema. Add constraints such as `jsonschema:"format=uri"` or `jsonschema:"description=the displayed price"` when the Go type alone is not specific enough.

## More Examples

Run the flat examples directly from the repository:

```sh
go -C packages/sdk-go run examples/act.go
go -C packages/sdk-go run examples/extract.go
```
