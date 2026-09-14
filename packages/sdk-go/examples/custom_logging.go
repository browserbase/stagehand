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

func main() {
	if err := run(context.Background()); err != nil {
		log.Fatal(err)
	}
}

func run(ctx context.Context) (err error) {
	apiKey := os.Getenv("OPENAI_API_KEY")
	if apiKey == "" {
		return errors.New("OPENAI_API_KEY is required")
	}
	logFile, err := os.OpenFile("stagehand.jsonl", os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer func() { err = errors.Join(err, logFile.Close()) }()

	model := stagehand.ModelConfig{
		ModelName: "openai/gpt-5.4-mini",
		APIKey:    &apiKey,
	}
	browser, err := stagehand.LaunchLocalBrowser(ctx, &stagehand.LocalBrowserLaunchOptions{Headless: true})
	if err != nil {
		return err
	}
	defer func() { err = errors.Join(err, browser.Close(ctx)) }()

	client, err := stagehand.Create(ctx, stagehand.CreateOptions{
		Browser: browser,
		Model:   &model,
		Logging: &stagehand.StagehandClientLoggingConfig{
			Level:  stagehand.StagehandClientLogLevelInfo,
			Format: stagehand.StagehandClientLogFormatPretty,
			OnLog: func(entry stagehand.StagehandLog) {
				_ = json.NewEncoder(logFile).Encode(entry)
			},
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
	if len(pages) == 0 {
		return errors.New("Stagehand initialized without an active page")
	}
	page := pages[0]
	if _, err := page.Goto(ctx, "https://example.com", nil); err != nil {
		return err
	}
	instruction := "Find the Learn more link"
	result, err := client.Observe(ctx, &instruction, nil)
	if err != nil {
		return err
	}
	fmt.Println(result.Data)
	return nil
}
