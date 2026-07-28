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
	model, err := modelFromEnvironment()
	if err != nil {
		return err
	}
	client := stagehand.New(stagehand.StagehandClientInitParams{
		Browser: stagehand.LocalBrowserSource{Headless: true},
		Model:   &model,
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

	result, err := client.Act(
		ctx,
		"Click the link that provides more information about Example Domain",
		nil,
	)
	if err != nil {
		return err
	}
	output, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		return err
	}
	fmt.Println(string(output))
	if !result.Data.Success {
		return fmt.Errorf("act failed: %s", result.Data.Message)
	}
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
