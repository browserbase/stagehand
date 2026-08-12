package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"

	stagehand "github.com/browserbase/stagehand/packages/sdk-go/v4"
)

type pageInfo struct {
	Heading     string `json:"heading"`
	Description string `json:"description"`
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

	client, err := stagehand.Create(ctx, stagehand.CreateOptions{Browser: browser, Generate: generateWithHTTP})
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

	extractResult, err := stagehand.Extract[pageInfo](
		ctx,
		client,
		"Extract the page heading and description",
		nil,
	)
	if err != nil {
		return err
	}
	instruction := "Find the link that provides more information about Example Domain"
	observeResult, err := client.Observe(ctx, &instruction, nil)
	if err != nil {
		return err
	}
	actResult, err := client.Act(
		ctx,
		stagehand.ActInstruction(
			"Click the link that provides more information about Example Domain",
		),
		nil,
	)
	if err != nil {
		return err
	}
	output, err := json.MarshalIndent(map[string]any{
		"page_info": extractResult.Data, "actions": observeResult.Data, "action_result": actResult.Data,
	}, "", "  ")
	if err != nil {
		return err
	}
	fmt.Println(string(output))
	if len(observeResult.Data) == 0 {
		return errors.New("observe returned no matching actions")
	}
	if !actResult.Data.Success {
		return fmt.Errorf("act failed: %s", actResult.Data.Message)
	}
	return nil
}

// generateWithHTTP delegates the generated Stagehand LLM union directly to a
// user-operated HTTP endpoint and decodes the same generated result union.
func generateWithHTTP(
	ctx context.Context,
	params stagehand.LLMGenerateParams,
) (stagehand.LLMGenerateResult, error) {
	endpoint := os.Getenv("CUSTOM_LLM_URL")
	if endpoint == "" {
		return stagehand.LLMGenerateResult{}, errors.New("CUSTOM_LLM_URL is required")
	}
	body, err := json.Marshal(params)
	if err != nil {
		return stagehand.LLMGenerateResult{}, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return stagehand.LLMGenerateResult{}, err
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return stagehand.LLMGenerateResult{}, err
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return stagehand.LLMGenerateResult{}, fmt.Errorf("custom LLM returned %s", response.Status)
	}
	var result stagehand.LLMGenerateResult
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		return stagehand.LLMGenerateResult{}, err
	}
	return result, nil
}
