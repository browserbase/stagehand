package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"

	stagehand "github.com/browserbase/stagehand/packages/sdk-go"
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
	browser, err := stagehand.LaunchBrowserbase(ctx, stagehand.BrowserbaseLaunchOptions{APIKey: apiKey})
	if err != nil {
		return err
	}
	defer func() { err = errors.Join(err, browser.Close(ctx)) }()

	client, err := stagehand.Create(ctx, stagehand.CreateOptions{Browser: browser})
	if err != nil {
		return err
	}
	defer func() { err = errors.Join(err, client.Close(ctx)) }()

	browserContext, err := client.Context()
	if err != nil {
		return err
	}
	page, err := browserContext.ActivePage(ctx)
	if err != nil {
		return err
	}
	if page == nil {
		return errors.New("Stagehand initialized without an active page")
	}
	if _, err := page.Goto(ctx, "https://example.com", nil); err != nil {
		return err
	}

	result, err := client.Extract(
		ctx,
		"Extract the page heading and the domain this page says it is for",
		pageInfoSchema,
		nil,
	)
	if err != nil {
		return err
	}
	var info pageInfo
	if err := json.Unmarshal(result.Data, &info); err != nil {
		return fmt.Errorf("decode extracted page info: %w", err)
	}
	output, err := json.MarshalIndent(info, "", "  ")
	if err != nil {
		return err
	}
	fmt.Println(string(output))
	return nil
}
