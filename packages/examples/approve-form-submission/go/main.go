package main

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"strings"

	stagehand "github.com/browserbase/stagehand/packages/sdk-go/v4"
)

func main() {
	if err := run(context.Background()); err != nil {
		log.Fatal(err)
	}
}
func run(ctx context.Context) (err error) {
	apiKey, modelKey := os.Getenv("BROWSERBASE_API_KEY"), os.Getenv("OPENAI_API_KEY")
	if apiKey == "" || modelKey == "" {
		return errors.New("BROWSERBASE_API_KEY and OPENAI_API_KEY are required")
	}
	browser, err := stagehand.LaunchBrowserbase(ctx, stagehand.BrowserbaseLaunchOptions{APIKey: apiKey})
	if err != nil {
		return err
	}
	defer func() { err = errors.Join(err, browser.Close(ctx)) }()
	client, err := stagehand.Create(ctx, stagehand.CreateOptions{Browser: browser, Model: &stagehand.ModelConfig{ModelName: "openai/gpt-5.4-mini", APIKey: &modelKey}})
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
	if _, err = page.Goto(ctx, "https://httpbin.org/forms/post", nil); err != nil {
		return err
	}
	fields := []struct{ instruction, name, value string }{
		{"Type %customer% into the customer name field", "customer", "Ada Lovelace"},
		{"Type %email% into the email field", "email", "ada@example.com"},
		{"Type %comments% into the comments field", "comments", "Leave at reception"},
	}
	for _, field := range fields {
		result, actErr := client.Act(ctx, stagehand.ActInstruction(field.instruction), &stagehand.StagehandClientActOptions{Page: page, Variables: stagehand.Variables{field.name: stagehand.PrimitiveVariable(stagehand.StringVariable(field.value))}})
		if actErr != nil {
			return actErr
		}
		if !result.Data.Success {
			return fmt.Errorf("fill failed: %s", result.Data.Message)
		}
	}
	size, err := client.Act(ctx, stagehand.ActInstruction("Select the medium size"), &stagehand.StagehandClientActOptions{Page: page})
	if err != nil {
		return err
	}
	if !size.Data.Success {
		return fmt.Errorf("size selection failed: %s", size.Data.Message)
	}
	fmt.Print("Submit this form? [y/N] ")
	answer, err := bufio.NewReader(os.Stdin).ReadString('\n')
	if err != nil {
		return err
	}
	if strings.ToLower(strings.TrimSpace(answer)) != "y" {
		fmt.Println("Rejected: submit was not executed.")
		return nil
	}
	submitted, err := client.Act(ctx, stagehand.ActInstruction("Click the Submit order button"), &stagehand.StagehandClientActOptions{Page: page})
	if err != nil {
		return err
	}
	if !submitted.Data.Success {
		return fmt.Errorf("submit failed: %s", submitted.Data.Message)
	}
	if err = page.WaitForLoadState(ctx, stagehand.LoadStateDOMContentLoaded, nil); err != nil {
		return err
	}
	url, err := page.URL(ctx)
	if err != nil {
		return err
	}
	fmt.Printf("Submitted once: %s\n", url)
	return nil
}
