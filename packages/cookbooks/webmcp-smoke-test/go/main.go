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
	browser, err := stagehand.LaunchLocalBrowser(ctx, &stagehand.LocalBrowserLaunchOptions{Headless: true})
	if err != nil {
		return err
	}
	defer func() { err = errors.Join(err, browser.Close(ctx)) }()
	client, err := stagehand.Create(ctx, stagehand.CreateOptions{Browser: browser})
	if err != nil {
		return err
	}
	defer func() { err = errors.Join(err, client.Close(ctx)) }()
	bc, err := browser.Context()
	if err != nil {
		return err
	}
	page, err := bc.ActivePage(ctx)
	if err != nil {
		return err
	}
	if page == nil {
		return errors.New("no active page")
	}
	target := envDefault("WEBMCP_URL", "https://browserbase.github.io/stagehand-eval-sites/sites/webmcp-test/")
	name := envDefault("WEBMCP_TOOL", "calculateSum")
	if _, err = page.Goto(ctx, target, nil); err != nil {
		return err
	}
	tools, err := page.Tools(ctx, &stagehand.WebMCPToolsOptions{Timeout: 5000})
	if err != nil {
		return err
	}
	if len(tools) == 0 {
		actualURL, urlErr := page.URL(ctx)
		if urlErr != nil {
			return urlErr
		}
		return fmt.Errorf("no WebMCP tools on %s (browser opened %s)", target, actualURL)
	}
	var match *stagehand.WebMCPTool
	for _, tool := range tools {
		if tool.Descriptor().Name == name {
			match = tool
			break
		}
	}
	if match == nil {
		return fmt.Errorf("expected WebMCP tool %q was not registered", name)
	}
	var input stagehand.WebMCPInput
	if err := json.Unmarshal([]byte(envDefault("WEBMCP_INPUT", `{"a":19,"b":23}`)), &input); err != nil {
		return fmt.Errorf("WEBMCP_INPUT must be a JSON object: %w", err)
	}
	if input == nil {
		return errors.New("WEBMCP_INPUT must be a JSON object")
	}
	invocation, err := match.Invoke(ctx, input)
	if err != nil {
		return err
	}
	result, err := invocation.Result(ctx, nil)
	if err != nil {
		return err
	}
	if result.Status != "Completed" {
		return fmt.Errorf("WebMCP tool %s finished with status %s", name, result.Status)
	}
	fmt.Printf("%s: %s\n", name, result.Status)
	return nil
}
func envDefault(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}
