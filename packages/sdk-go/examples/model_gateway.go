package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"

	stagehand "github.com/browserbase/stagehand/packages/sdk-go/v4"
)

type pageInfo struct {
	Heading string `json:"heading"`
	Domain  string `json:"domain"`
}

var pageInfoSchema = json.RawMessage(`{
  "type": "object",
  "properties": {
    "heading": {"type": "string"},
    "domain": {"type": "string"}
  },
  "required": ["heading", "domain"],
  "additionalProperties": false
}`)

const (
	browserbaseBaseURL = "https://api.browserbase.com"
	stagehandAPIURL    = "https://api.stagehand.browserbase.com"
)

func main() {
	if err := run(context.Background()); err != nil {
		log.Fatal(err)
	}
}

func run(ctx context.Context) (err error) {
	apiKey := os.Getenv("BROWSERBASE_API_KEY")
	if apiKey == "" {
		return errors.New("BROWSERBASE_API_KEY is required")
	}
	// With no model, Browserbase Model Gateway selects one automatically for
	// each inference call. The Browserbase API key and session authenticate it.
	browser, err := stagehand.LaunchBrowserbase(ctx, stagehand.BrowserbaseLaunchOptions{
		APIKey:  apiKey,
		BaseURL: browserbaseBaseURL,
	})
	if err != nil {
		return err
	}
	defer func() { err = errors.Join(err, browser.Close(ctx)) }()

	stagehandURL := stagehandAPIURL
	client, err := stagehand.Create(ctx, stagehand.CreateOptions{
		Browser: browser,
		APIURL:  &stagehandURL,
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
	if len(pages) == 0 {
		return errors.New("Stagehand initialized without an active page")
	}
	page := pages[0]
	if _, err := page.Goto(ctx, "https://example.com", nil); err != nil {
		return err
	}

	result, err := stagehand.Extract[pageInfo](
		ctx,
		client,
		"Extract the page heading and the domain this page says it is for",
		nil,
	)
	if err != nil {
		return err
	}
	output, err := json.MarshalIndent(result.Data, "", "  ")
	if err != nil {
		return err
	}
	fmt.Println(string(output))
	return nil
}
