package stagehand

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

func TestStagehandLocalBrowserIntegration(t *testing.T) {
	chromePath, err := findChromePath("")
	if err != nil {
		t.Skipf("Chrome is not installed: %v", err)
	}
	fixtureBody := []byte(
		`<!doctype html><html><head><title>Stagehand Go Response</title></head>` +
			`<body>navigation response</body></html>`,
	)
	fixture := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("Content-Type", "text/html; charset=utf-8")
		writer.Header().Set("X-Stagehand-Fixture", "go-navigation-response")
		_, _ = writer.Write(fixtureBody)
	}))
	defer fixture.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	client := New(StagehandClientInitParams{
		Browser: LocalBrowserSource{
			ExecutablePath:   chromePath,
			Headless:         true,
			ConnectTimeoutMs: 15_000,
		},
	})
	closeStagehandAfterTest(t, client)

	if err := client.Init(ctx); err != nil {
		t.Fatalf("Stagehand.Init() with local browser error = %v", err)
	}
	extensionDir := client.browser.extensionDir
	assertLiveStagehand(t, ctx, client)
	assertNavigationResponse(t, ctx, client, fixture.URL, fixtureBody)
	if err := client.Close(ctx); err != nil {
		t.Fatalf("Stagehand.Close() with local browser error = %v", err)
	}
	assertExtensionDirectoryRemoved(t, extensionDir)
}

func assertNavigationResponse(
	t *testing.T,
	ctx context.Context,
	client *Stagehand,
	fixtureURL string,
	fixtureBody []byte,
) {
	t.Helper()
	browserContext, err := client.Context()
	if err != nil {
		t.Fatalf("Stagehand.Context() error = %v", err)
	}
	page, err := browserContext.ActivePage(ctx)
	if err != nil {
		t.Fatalf("BrowserContext.ActivePage() error = %v", err)
	}
	if page == nil {
		t.Fatal("BrowserContext.ActivePage() = nil")
	}

	response, err := page.Goto(ctx, fixtureURL, nil)
	if err != nil {
		t.Fatalf("Page.Goto() error = %v", err)
	}
	if response == nil {
		t.Fatal("Page.Goto() response = nil")
	}
	if response.Status() != http.StatusOK || response.StatusText() != "OK" || !response.OK() {
		t.Fatalf(
			"navigation response status = (%d, %q, ok=%t)",
			response.Status(),
			response.StatusText(),
			response.OK(),
		)
	}
	if strings.TrimSuffix(response.URL(), "/") != fixtureURL {
		t.Fatalf("navigation response URL = %q, want %q", response.URL(), fixtureURL)
	}
	if response.Headers()["x-stagehand-fixture"] != "go-navigation-response" {
		t.Fatalf("navigation response headers = %#v", response.Headers())
	}
	header, present, err := response.HeaderValue(ctx, "X-Stagehand-Fixture")
	if err != nil || !present || header != "go-navigation-response" {
		t.Fatalf("Response.HeaderValue() = (%q, %t, %v)", header, present, err)
	}
	body, err := response.Body(ctx)
	if err != nil || !bytes.Equal(body, fixtureBody) {
		t.Fatalf("Response.Body() = (%q, %v)", body, err)
	}
	text, err := response.Text(ctx)
	if err != nil || text != string(fixtureBody) {
		t.Fatalf("Response.Text() = (%q, %v)", text, err)
	}
	if err := response.Finished(ctx); err != nil {
		t.Fatalf("Response.Finished() error = %v", err)
	}
	if ref := page.Ref(); ref.URL == nil || *ref.URL != response.URL() {
		t.Fatalf("Page.Ref() = %#v, response URL = %q", ref, response.URL())
	}
}

func TestStagehandExistingCDPBrowserIntegration(t *testing.T) {
	chromePath, err := findChromePath("")
	if err != nil {
		t.Skipf("Chrome is not installed: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	launched, err := launchChrome(ctx, LocalBrowserSource{
		ExecutablePath:   chromePath,
		Headless:         true,
		ConnectTimeoutMs: 15_000,
	})
	if err != nil {
		t.Fatalf("launch Chrome for existing CDP source: %v", err)
	}
	t.Cleanup(func() {
		closeContext, closeCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer closeCancel()
		if err := launched.close(closeContext); err != nil {
			t.Errorf("close existing CDP Chrome: %v", err)
		}
	})

	client := New(StagehandClientInitParams{
		Browser: CDPBrowserSource{CDPURL: launched.cdpURL},
	})
	closeStagehandAfterTest(t, client)
	if err := client.Init(ctx); err != nil {
		t.Fatalf("Stagehand.Init() with existing CDP error = %v", err)
	}
	extensionDir := client.browser.extensionDir
	assertLiveStagehand(t, ctx, client)
	if err := client.Close(ctx); err != nil {
		t.Fatalf("Stagehand.Close() with existing CDP error = %v", err)
	}

	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodGet,
		launched.cdpURL+"/json/version",
		nil,
	)
	if err != nil {
		t.Fatalf("create kept-alive existing CDP browser request: %v", err)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("kept-alive existing CDP browser is unavailable: %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf(
			"kept-alive existing CDP browser status = %d, want 200",
			response.StatusCode,
		)
	}
	if _, err := os.Stat(extensionDir); err != nil {
		t.Fatalf("kept-alive extension directory is unavailable: %v", err)
	}
	t.Cleanup(func() {
		if err := os.RemoveAll(extensionDir); err != nil {
			t.Errorf("remove kept-alive extension directory: %v", err)
		}
	})
}

func TestStagehandExtractSendsScreenshotToClientLLM(t *testing.T) {
	chromePath, err := findChromePath("")
	if err != nil {
		t.Skipf("Chrome is not installed: %v", err)
	}

	fixture := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = writer.Write([]byte(
			`<!doctype html><html><head><title>Stagehand Go Screenshot</title></head>` +
				`<body><h1>Stagehand Go Screenshot</h1></body></html>`,
		))
	}))
	defer fixture.Close()

	screenshots := make(chan LLMImageContent, 1)
	generate := func(
		_ context.Context,
		params LLMGenerateParams,
	) (LLMGenerateResult, error) {
		structured, ok := params.AsStructured()
		if !ok {
			return LLMGenerateResult{}, errors.New("smoke LLM only supports structured generation")
		}
		for _, message := range structured.Messages {
			for _, block := range message.Content {
				if image, ok := block.AsImage(); ok {
					select {
					case screenshots <- image:
					default:
					}
				}
			}
		}

		content := json.RawMessage(`{"heading":"Stagehand Go Screenshot"}`)
		if structured.ResponseFormat.Name == "Metadata" {
			content = json.RawMessage(
				`{"progress":"The requested heading was extracted","completed":true}`,
			)
		}
		return StructuredGenerateResult(LLMStructuredGenerateResult{
			Role: LLMRoleAssistant,
			Content: LLMMessageContent{
				TextContentBlock(LLMTextContent{Text: string(content)}),
			},
			StructuredContent: content,
		}), nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	client := New(StagehandClientInitParams{
		Browser: LocalBrowserSource{
			ExecutablePath:   chromePath,
			Headless:         true,
			ConnectTimeoutMs: 15_000,
		},
		Generate: generate,
	})
	closeStagehandAfterTest(t, client)
	if err := client.Init(ctx); err != nil {
		t.Fatalf("Stagehand.Init() with screenshot LLM error = %v", err)
	}
	browserContext, err := client.Context()
	if err != nil {
		t.Fatalf("Stagehand.Context() error = %v", err)
	}
	page, err := browserContext.ActivePage(ctx)
	if err != nil {
		t.Fatalf("BrowserContext.ActivePage() error = %v", err)
	}
	if page == nil {
		page, err = browserContext.NewPage(ctx, ContextNewPageParams{})
		if err != nil {
			t.Fatalf("BrowserContext.NewPage() error = %v", err)
		}
	}
	if _, err := page.Goto(ctx, fixture.URL, nil); err != nil {
		t.Fatalf("Page.Goto() error = %v", err)
	}

	screenshot := true
	result, err := client.Extract(
		ctx,
		"Extract the page heading",
		json.RawMessage(
			`{"type":"object","properties":{"heading":{"type":"string"}},"required":["heading"]}`,
		),
		&StagehandClientExtractOptions{
			ExtractOptions: ExtractOptions{Screenshot: &screenshot},
			Page:           page,
		},
	)
	if err != nil {
		t.Fatalf("Stagehand.Extract() with screenshot error = %v", err)
	}
	var extracted struct {
		Heading string `json:"heading"`
	}
	if err := json.Unmarshal(result.Data, &extracted); err != nil {
		t.Fatalf("decode Extract() data: %v", err)
	}
	if extracted.Heading != "Stagehand Go Screenshot" {
		t.Fatalf("Extract() heading = %q", extracted.Heading)
	}

	var image LLMImageContent
	select {
	case image = <-screenshots:
	default:
		t.Fatal("client LLM did not receive the requested extraction screenshot")
	}
	if image.Type != "image" || image.MIMEType != "image/png" {
		t.Fatalf("screenshot content = %#v", image)
	}
	png, err := base64.StdEncoding.DecodeString(image.Data)
	if err != nil {
		t.Fatalf("decode LLM screenshot: %v", err)
	}
	if signature := []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'}; !bytes.HasPrefix(png, signature) {
		t.Fatalf("LLM screenshot is not PNG data: %v", png[:min(len(png), len(signature))])
	}

	if err := client.Close(ctx); err != nil {
		t.Fatalf("Stagehand.Close() with screenshot LLM error = %v", err)
	}
}

func TestStagehandBrowserbaseIntegration(t *testing.T) {
	if os.Getenv("BROWSERBASE_SMOKE") != "1" {
		t.Skip("set BROWSERBASE_SMOKE=1 to run the Browserbase integration test")
	}
	apiKey := os.Getenv("BROWSERBASE_API_KEY")
	if apiKey == "" {
		t.Fatal("BROWSERBASE_API_KEY is required when BROWSERBASE_SMOKE=1")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	client := New(StagehandClientInitParams{
		APIKey: &apiKey,
		Browser: BrowserbaseClientBrowserSource{
			KeepAlive: testPointer(false),
			Timeout:   testPointer(300.0),
			UserMetadata: map[string]json.RawMessage{
				"suite": json.RawMessage(`"stagehand-go-public-smoke"`),
			},
		},
	})
	closeStagehandAfterTest(t, client)

	if err := client.Init(ctx); err != nil {
		t.Fatalf("Stagehand.Init() with Browserbase error = %v", err)
	}
	sessionID := client.browser.browserbaseSessionID
	assertLiveStagehand(t, ctx, client)
	if err := client.Close(ctx); err != nil {
		t.Fatalf("Stagehand.Close() with Browserbase error = %v", err)
	}
	t.Logf("created and released Browserbase session %s", sessionID)
}

func assertLiveStagehand(
	t *testing.T,
	ctx context.Context,
	client *Stagehand,
) {
	t.Helper()
	if !client.Initialized() {
		t.Fatal("Stagehand.Initialized() = false after Init")
	}
	browserContext, err := client.Context()
	if err != nil {
		t.Fatalf("Stagehand.Context() error = %v", err)
	}
	page, err := browserContext.ActivePage(ctx)
	if err != nil {
		t.Fatalf("BrowserContext.ActivePage() error = %v", err)
	}
	if page == nil || page.PageID() == "" {
		t.Fatalf("BrowserContext.ActivePage() = %#v", page)
	}
}

func closeStagehandAfterTest(t *testing.T, client *Stagehand) {
	t.Helper()
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := client.Close(ctx); err != nil &&
			!errors.Is(err, ErrCDPClientClosed) &&
			!errors.Is(err, ErrCDPConnectionClosed) {
			t.Errorf("clean up Stagehand client: %v", err)
		}
	})
}

func assertExtensionDirectoryRemoved(t *testing.T, directory string) {
	t.Helper()
	if _, err := os.Stat(directory); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("temporary extension directory still exists after close: %v", err)
	}
}
