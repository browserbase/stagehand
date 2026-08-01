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
	Heading     string `json:"heading"`
	Description string `json:"description"`
}

var pageInfoSchema = json.RawMessage(`{
  "type": "object",
  "properties": {
    "heading": {"type": "string"},
    "description": {"type": "string"}
  },
  "required": ["heading", "description"],
  "additionalProperties": false
}`)

func main() {
	if err := run(context.Background()); err != nil {
		log.Fatal(err)
	}
}

func run(ctx context.Context) (err error) {
	model, err := modelFromEnvironment()
	if err != nil {
		return err
	}
	browser, err := stagehand.LaunchLocalBrowser(ctx, &stagehand.LocalBrowserLaunchOptions{Headless: true})
	if err != nil {
		return err
	}
	defer func() { err = errors.Join(err, browser.Close(ctx)) }()

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
	if err := page.Goto(ctx, "https://example.com", nil); err != nil {
		return err
	}

	result, err := client.Extract(
		ctx,
		"Extract the page heading and description",
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

func modelFromEnvironment() (stagehand.ModelConfig, error) {
	apiKey := os.Getenv("OPENAI_API_KEY")
	if apiKey == "" {
		return stagehand.ModelConfig{}, errors.New("OPENAI_API_KEY is required")
	}
	return stagehand.KnownModel(stagehand.KnownModelConfig{
		ModelName: "openai/gpt-5.4-mini",
		APIKey:    &apiKey,
	}), nil
}
