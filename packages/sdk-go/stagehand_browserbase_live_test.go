package stagehand

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestBrowserbaseRoutingInChromium(t *testing.T) {
	chromePath, err := findChromePath("")
	if err != nil {
		t.Skipf("Chrome is not installed: %v", err)
	}
	data, err := os.ReadFile("../../tests/fixtures/browserbase-routing.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture map[string]json.RawMessage
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	var source string
	if err := json.Unmarshal(fixture["batchSource"], &source); err != nil {
		t.Fatal(err)
	}
	for _, mode := range []string{"gateway", "custom", "cache-failure", "direct"} {
		t.Run(mode, func(t *testing.T) {
			type request struct {
				path    string
				headers http.Header
				model   string
			}
			var mu sync.Mutex
			var requests []request
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/page" {
					w.Header().Set("Content-Type", "text/html")
					_, _ = w.Write([]byte("<html><body><h1>Answer: 42</h1></body></html>"))
					return
				}
				if r.Method != http.MethodPost {
					http.NotFound(w, r)
					return
				}
				var body struct {
					Model string `json:"model"`
					Text  struct {
						Format struct {
							Name string `json:"name"`
						} `json:"format"`
					} `json:"text"`
				}
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
				}
				mu.Lock()
				requests = append(requests, request{r.URL.Path, r.Header.Clone(), body.Model})
				mu.Unlock()
				key := "cacheSet"
				if strings.HasSuffix(r.URL.Path, "/responses") {
					key = "gateway"
					if body.Text.Format.Name == "Metadata" {
						key = "metadata"
					}
				} else if strings.HasSuffix(r.URL.Path, "/cache/get") {
					key = "cacheMiss"
					if mode == "direct" {
						key = "cacheHit"
					}
				}
				w.Header().Set("Content-Type", "application/json")
				if mode == "cache-failure" {
					w.WriteHeader(503)
				}
				_, _ = w.Write(fixture[key])
			}))
			t.Cleanup(server.Close)
			ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
			defer cancel()
			browser, err := LaunchLocalBrowser(ctx, &LocalBrowserLaunchOptions{ExecutablePath: chromePath, Headless: true})
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = browser.Close(context.Background()) })
			// Session acquisition is a fixture; Chrome, the worker, RPC, and HTTP are real.
			browser.workerAPIKey = testPointer("bb-browser-routing")
			browser.workerBrowser = &BrowserSessionMetadata{SessionID: "session-routing"}
			var calls atomic.Int32
			options := CreateOptions{Browser: browser, APIKey: testPointer("bb-caller-routing"), APIURL: testPointer(server.URL + "/services"), Logging: &StagehandClientLoggingConfig{Level: StagehandClientLogLevelOff}}
			if mode == "direct" {
				options.Model = &ModelConfig{ModelName: "openai/gpt-5", APIKey: testPointer("provider-routing")}
			} else if mode != "gateway" {
				options.Generate = func(_ context.Context, params LLMGenerateParams) (LLMGenerateResult, error) {
					calls.Add(1)
					structured, ok := params.AsStructured()
					if !ok {
						return LLMGenerateResult{}, errors.New("expected structured generation")
					}
					value := json.RawMessage(`{"answer":42}`)
					if structured.ResponseFormat.Name == "Metadata" {
						value = json.RawMessage(`{"progress":"Complete","completed":true}`)
					}
					return StructuredGenerateResult(LLMStructuredGenerateResult{
						Role: LLMRoleAssistant, Content: LLMMessageContent{TextContentBlock(LLMTextContent{Text: string(value)})}, StructuredContent: value,
					}), nil
				}
			}
			client, err := Create(ctx, options)
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = client.Close(context.Background()) })
			browserContext, err := browser.Context()
			if err != nil {
				t.Fatal(err)
			}
			page, err := browserContext.NewPage(ctx)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := page.Goto(ctx, server.URL+"/page", nil); err != nil {
				t.Fatal(err)
			}
			if err := browserContext.SetActivePage(ctx, page); err != nil {
				t.Fatal(err)
			}
			type answer struct {
				Answer int `json:"answer"`
			}
			result, err := Extract[answer](ctx, client, "Extract the answer", nil)
			if err != nil {
				t.Fatal(err)
			}
			want := 42
			if mode == "direct" {
				want = 7
			}
			if result.Data.Answer != want {
				t.Fatalf("answer = %d, want %d", result.Data.Answer, want)
			}
			if mode == "gateway" || mode == "custom" {
				var batch struct {
					Data answer `json:"data"`
				}
				if err := client.ExperimentalBatch(ctx, source, nil, &batch, ExperimentalBatchOptions{}); err != nil {
					t.Fatal(err)
				}
				if batch.Data.Answer != 42 {
					t.Fatalf("batch = %#v", batch)
				}
			}
			if mode == "custom" {
				before := calls.Load()
				result, err = Extract[answer](ctx, client, "Extract the answer", &StagehandClientExtractOptions{Model: &ModelConfig{ModelName: "anthropic/claude-sonnet-4-6"}})
				if err != nil || result.Data.Answer != 42 {
					t.Fatalf("override result = %#v, %v", result, err)
				}
				var batch any
				override := strings.TrimSuffix(source, ")") + `, {model: {modelName: "anthropic/claude-sonnet-4-6"}})`
				if err := client.ExperimentalBatch(ctx, override, nil, &batch, ExperimentalBatchOptions{}); err != nil {
					t.Fatal(err)
				}
				if calls.Load() != before || before != 4 {
					t.Fatalf("custom callback count = %d, before %d", calls.Load(), before)
				}
			}
			if mode == "cache-failure" && calls.Load() != 2 {
				t.Fatal("cache failure did not fall back to custom client")
			}
			mu.Lock()
			defer mu.Unlock()
			counts := map[string]int{}
			for _, r := range requests {
				counts[r.path]++
				if r.headers.Get("X-BB-API-Key") != "bb-browser-routing" {
					t.Fatal("factory key precedence changed")
				}
				if strings.HasSuffix(r.path, "/responses") {
					if r.headers.Get("X-BB-Session-ID") != "session-routing" {
						t.Fatal("missing session header")
					}
					model := ""
					if mode == "custom" {
						model = "anthropic/claude-sonnet-4-6"
					}
					if r.model != model {
						t.Fatalf("model = %q, want %q", r.model, model)
					}
				}
			}
			wantGets := map[string]int{"gateway": 2, "custom": 4, "cache-failure": 1, "direct": 1}[mode]
			wantSets := wantGets
			if mode == "direct" {
				wantSets = 0
			}
			wantGateway := map[string]int{"gateway": 4, "custom": 4}[mode]
			if counts["/services/v1/cache/get"] != wantGets || counts["/services/v1/cache/set"] != wantSets || counts["/services/v1/llm/responses"] != wantGateway {
				t.Fatalf("unexpected HTTP operations: %v", counts)
			}
		})
	}
}
