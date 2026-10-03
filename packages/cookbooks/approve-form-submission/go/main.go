package main

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"log"
	"net/url"
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
	if apiKey == "" {
		return errors.New("BROWSERBASE_API_KEY is required")
	}
	if modelKey == "" {
		return errors.New("OPENAI_API_KEY is required")
	}
	timeout := float64(300)
	browser, err := stagehand.LaunchBrowserbase(ctx, stagehand.BrowserbaseLaunchOptions{APIKey: apiKey, Timeout: &timeout})
	if err != nil {
		return err
	}
	defer func() { err = errors.Join(err, browser.Close(context.Background())) }()
	fmt.Printf("Session: https://www.browserbase.com/sessions/%s\n", browser.SessionID())
	opts := stagehand.CreateOptions{
		Browser: browser,
		Model:   &stagehand.ModelConfig{ModelName: "openai/gpt-6-sol", APIKey: &modelKey},
	}
	client, err := stagehand.Create(ctx, opts)
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
	expected := map[string]string{"customer": "Ada Lovelace", "email": "ada@example.com", "size": "medium", "comments": "Leave at reception"}
	selectors := map[string]string{"customer": `[name="custname"]`, "email": `[name="custemail"]`, "size": `[name="size"]:checked`, "comments": `[name="comments"]`}
	verifyValues := func() error {
		for name, selector := range selectors {
			value, err := page.Locator(selector).InputValue(ctx)
			if err != nil {
				return err
			}
			if value != expected[name] {
				return fmt.Errorf("form value %s does not match the approval payload", name)
			}
		}
		return nil
	}
	if err = verifyValues(); err != nil {
		return err
	}
	fmt.Printf("Form values to submit: %v\n", expected)
	fmt.Print("Submit this form? [y/N] ")
	answer, err := bufio.NewReader(os.Stdin).ReadString('\n')
	if err != nil {
		return err
	}
	if strings.ToLower(strings.TrimSpace(answer)) != "y" {
		fmt.Println("Rejected: submit was not executed.")
		return nil
	}
	if err = verifyValues(); err != nil {
		return err
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
	submittedURL, err := page.URL(ctx)
	if err != nil {
		return err
	}
	destination, err := url.Parse(submittedURL)
	if err != nil {
		return err
	}
	if destination.Scheme != "https" || destination.Host != "httpbin.org" || destination.Path != "/post" {
		return errors.New("submission destination was not verified; inspect before rerunning")
	}
	fmt.Printf("Submitted once: %s\n", submittedURL)
	return nil
}
