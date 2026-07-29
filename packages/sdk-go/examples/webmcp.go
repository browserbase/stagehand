package main

import (
	"context"
	"errors"
	"fmt"
	"log"

	stagehand "github.com/browserbase/stagehand/packages/sdk-go"
)

const webMCPTestSite = "https://browserbase.github.io/stagehand-eval-sites/sites/webmcp-test/"

func main() {
	if err := run(context.Background()); err != nil {
		log.Fatal(err)
	}
}

func run(ctx context.Context) (err error) {
	client := stagehand.New(stagehand.StagehandClientInitParams{
		Browser: stagehand.LocalBrowserSource{Headless: false},
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
	if err := page.Goto(ctx, webMCPTestSite, nil); err != nil {
		return err
	}

	tools, err := page.Tools(ctx, &stagehand.WebMCPToolsOptions{Timeout: 5_000})
	if err != nil {
		return err
	}
	var calculateSum *stagehand.WebMCPTool
	for _, tool := range tools {
		if tool.Descriptor().Name == "calculateSum" {
			calculateSum = tool
			break
		}
	}
	if calculateSum == nil {
		return errors.New("calculateSum was not registered by the page")
	}

	invocation, err := calculateSum.Invoke(ctx, stagehand.WebMCPInput{"a": 19, "b": 23})
	if err != nil {
		return err
	}
	result, err := invocation.Result(ctx, nil)
	if err != nil {
		return err
	}

	fmt.Printf("status: %s\noutput: %s\n", result.Status, result.Output)
	return nil
}
