package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"time"

	stagehand "github.com/browserbase/stagehand/packages/sdk-go"
)

type pageEventInfo struct {
	Heading     string `json:"heading"`
	Description string `json:"description"`
}

var pageEventInfoSchema = json.RawMessage(`{
  "type": "object",
  "properties": {
    "heading": {"type": "string"},
    "description": {"type": "string"}
  },
  "required": ["heading", "description"],
  "additionalProperties": false
}`)

func main() {
	if err := runPageEvents(context.Background()); err != nil {
		log.Fatal(err)
	}
}

func runPageEvents(ctx context.Context) (err error) {
	apiKey := os.Getenv("BROWSERBASE_API_KEY")
	if apiKey == "" {
		return errors.New("BROWSERBASE_API_KEY is required")
	}
	modelAPIKey := os.Getenv("OPENAI_API_KEY")
	if modelAPIKey == "" {
		return errors.New("OPENAI_API_KEY is required")
	}
	browser, err := stagehand.LaunchBrowserbase(ctx, stagehand.BrowserbaseLaunchOptions{APIKey: apiKey})
	if err != nil {
		return err
	}
	defer func() { err = errors.Join(err, browser.Close(ctx)) }()

	model := stagehand.ModelConfig{ModelName: "openai/gpt-5.4-mini", APIKey: &modelAPIKey}
	client, err := stagehand.Create(ctx, stagehand.CreateOptions{Browser: browser, Model: &model})
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

	consoleEvent := make(chan stagehand.PageCDPEvent, 1)
	subscription, err := page.On(ctx, "console", func(event stagehand.PageCDPEvent) {
		if string(event.Params["type"]) == `"log"` {
			consoleEvent <- event
		}
	})
	if err != nil {
		return err
	}
	defer func() { err = errors.Join(err, subscription.Close(ctx)) }()

	if _, err := page.Goto(ctx, "https://example.com", nil); err != nil {
		return err
	}
	if _, err := page.Evaluate(ctx, `console.log("stagehand-page-on-example"); "emitted"`); err != nil {
		return err
	}
	var event stagehand.PageCDPEvent
	select {
	case event = <-consoleEvent:
	case <-time.After(10 * time.Second):
		return errors.New("timed out waiting for the console event")
	}

	result, err := client.Extract(
		ctx,
		"Extract the page heading and description",
		pageEventInfoSchema,
		nil,
	)
	if err != nil {
		return err
	}
	var info pageEventInfo
	if err := json.Unmarshal(result.Data, &info); err != nil {
		return fmt.Errorf("decode extracted page info: %w", err)
	}
	output, err := json.MarshalIndent(map[string]any{
		"event_method": event.Method,
		"extracted":    info,
	}, "", "  ")
	if err != nil {
		return err
	}
	fmt.Println(string(output))
	return nil
}
