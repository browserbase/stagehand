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

	model := stagehand.KnownModel(stagehand.KnownModelConfig{
		ModelName: "openai/gpt-5.4-mini",
		APIKey:    &apiKey,
	})
	client := stagehand.New(stagehand.StagehandClientInitParams{
		Browser: stagehand.LocalBrowserSource{Headless: true},
		Model:   &model,
		Logging: &stagehand.StagehandClientLoggingConfig{
			OnLog: func(entry stagehand.StagehandLog) {
				_ = json.NewEncoder(logFile).Encode(entry)
			},
		},
	})
	if err := client.Init(ctx); err != nil {
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
	instruction := "Find the Learn more link"
	actions, err := client.Observe(ctx, &instruction, nil)
	if err != nil {
		return err
	}
	fmt.Println(actions)
	return nil
}
