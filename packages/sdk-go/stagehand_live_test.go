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
	"testing"
	"time"
)

func TestStagehandLocalBrowserIntegration(t *testing.T) {
	chromePath, err := findChromePath("")
	if err != nil {
		t.Skipf("Chrome is not installed: %v", err)
	}

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
	if err := client.Close(ctx); err != nil {
		t.Fatalf("Stagehand.Close() with local browser error = %v", err)
	}
	assertExtensionDirectoryRemoved(t, extensionDir)
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
	if err := page.Goto(ctx, fixture.URL, nil); err != nil {
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
