package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"

	stagehand "github.com/browserbase/stagehand/packages/sdk-go/v4"
)

func main() {
	if err := run(context.Background()); err != nil {
		log.Fatal(err)
	}
}
func run(ctx context.Context) (err error) {
	for _, name := range []string{"BROWSERBASE_API_KEY", "OPENAI_API_KEY", "LOGIN_USER", "LOGIN_PASSWORD"} {
		if os.Getenv(name) == "" {
			return fmt.Errorf("%s is required", name)
		}
	}
	apiKey := os.Getenv("BROWSERBASE_API_KEY")
	contextID, err := resolveContextID(ctx, apiKey)
	if err != nil {
		return err
	}
	persist, timeout := true, float64(300)
	navigationTimeout := 45000
	browser, err := stagehand.LaunchBrowserbase(ctx, stagehand.BrowserbaseLaunchOptions{APIKey: apiKey, Timeout: &timeout, BrowserSettings: &stagehand.BrowserbaseBrowserSettings{Context: &stagehand.BrowserbaseContext{ID: contextID, Persist: &persist}}})
	if err != nil {
		return err
	}
	defer func() { err = errors.Join(err, browser.Close(context.Background())) }()
	fmt.Printf("Session: https://www.browserbase.com/sessions/%s\n", browser.SessionID())
	key := os.Getenv("OPENAI_API_KEY")
	opts := stagehand.CreateOptions{
		Browser: browser,
		Model:   &stagehand.ModelConfig{ModelName: "openai/gpt-5.6-sol", APIKey: &key},
	}
	client, err := stagehand.Create(ctx, opts)
	if err != nil {
		return err
	}
	defer func() { err = errors.Join(err, client.Close(context.Background())) }()
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
	if _, err = page.Goto(ctx, "https://the-internet.herokuapp.com/secure", &stagehand.PageNavigationOptions{Timeout: &navigationTimeout}); err != nil {
		return err
	}
	ready, err := page.WaitForSelector(ctx, `a[href="/logout"], input#username`, nil)
	if err != nil {
		return err
	}
	if !ready {
		return errors.New("neither authenticated page nor login form is ready")
	}
	loginCount, err := page.Locator(`a[href="/logout"]`).Count(ctx)
	reused := loginCount > 0
	if err != nil {
		return err
	}
	if !reused {
		if _, err = page.Goto(ctx, "https://the-internet.herokuapp.com/login", &stagehand.PageNavigationOptions{Timeout: &navigationTimeout}); err != nil {
			return err
		}
		for _, step := range []struct{ instruction, name, value string }{
			{"Type %username% into the username field", "username", os.Getenv("LOGIN_USER")},
			{"Type %password% into the password field", "password", os.Getenv("LOGIN_PASSWORD")},
			{"Click the Login button", "", ""},
		} {
			variables := stagehand.Variables{}
			if step.name != "" {
				variables[step.name] = stagehand.PrimitiveVariable(stagehand.StringVariable(step.value))
			}
			result, actErr := client.Act(ctx, stagehand.ActInstruction(step.instruction), &stagehand.StagehandClientActOptions{Page: page, Variables: variables})
			if actErr != nil {
				return actErr
			}
			if !result.Data.Success {
				return errors.New("login action failed; inspect the session")
			}
		}
		if _, err = page.Goto(ctx, "https://the-internet.herokuapp.com/secure", &stagehand.PageNavigationOptions{Timeout: &navigationTimeout}); err != nil {
			return err
		}
	}
	authenticated, err := page.Locator(`a[href="/logout"]`).IsVisible(ctx)
	if err != nil {
		return err
	}
	if !authenticated {
		return errors.New("authentication failed; no retry was attempted")
	}
	output, err := json.MarshalIndent(map[string]any{"authenticated": true, "reused": reused, "sessionId": browser.SessionID()}, "", "  ")
	if err != nil {
		return err
	}
	if err = os.MkdirAll("out", 0755); err != nil {
		return err
	}
	if err = os.WriteFile("out/login.json", append(output, '\n'), 0600); err != nil {
		return err
	}
	fmt.Printf("Authenticated. Reused context: %t\n", reused)
	return nil
}

func resolveContextID(ctx context.Context, apiKey string) (string, error) {
	if id := os.Getenv("BROWSERBASE_CONTEXT_ID"); id != "" {
		return id, nil
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.browserbase.com/v1/contexts", bytes.NewReader([]byte("{}")))
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("create context failed: %s: %s", resp.Status, body)
	}
	var created struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(body, &created); err != nil {
		return "", err
	}
	if created.ID == "" {
		return "", errors.New("create context returned no id")
	}
	fmt.Println("Created Browserbase context:", created.ID)
	return created.ID, nil
}
