package stagehand

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
)

func TestOpenAICompatible(t *testing.T) {
	var request struct {
		Model    string `json:"model"`
		Messages []struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		} `json:"messages"`
		Temperature    *float64 `json:"temperature"`
		ResponseFormat struct {
			Type       string         `json:"type"`
			JSONSchema map[string]any `json:"json_schema"`
		} `json:"response_format"`
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" || r.Header.Get("Authorization") != "Bearer test-key" {
			t.Errorf("unexpected request: %s %s", r.URL.Path, r.Header.Get("Authorization"))
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Error(err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"{\"answer\":\"ok\"}"}}]}`))
	}))
	defer server.Close()

	generate := OpenAICompatible(OpenAICompatibleOptions{
		Model: "example/model", BaseURL: server.URL + "/v1/", APIKey: "test-key",
	})
	params := StructuredGenerateParams(LLMStructuredGenerateParams{
		Messages: []LLMMessage{{Role: LLMRoleUser, Content: LLMMessageContent{
			TextContentBlock(LLMTextContent{Text: "hello"}),
		}}},
		ResponseFormat: LLMJSONSchemaResponseFormat{Name: "answer", Schema: json.RawMessage(`{"type":"object"}`)},
	})
	result, err := generate(context.Background(), params)
	if err != nil {
		t.Fatal(err)
	}
	structured, ok := result.AsStructured()
	if !ok || string(structured.StructuredContent) != `{"answer":"ok"}` {
		t.Fatalf("unexpected result: %#v", result)
	}
	if request.Model != "example/model" || len(request.Messages) != 1 || request.Messages[0].Content != "hello" || request.ResponseFormat.Type != "json_schema" {
		t.Fatalf("unexpected request: %#v", request)
	}
	if request.Temperature != nil {
		t.Fatalf("unset temperature was sent: %v", *request.Temperature)
	}
	if _, ok := request.ResponseFormat.JSONSchema["description"]; ok {
		t.Fatal("unset schema description was sent")
	}
}

func TestOpenAICompatibleExtraBody(t *testing.T) {
	var request struct {
		Model           string         `json:"model"`
		Seed            int            `json:"seed"`
		ProviderOptions map[string]any `json:"providerOptions"`
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.RawQuery != "" {
			t.Errorf("unexpected query: %s", r.URL.RawQuery)
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Error(err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"{\"ok\":true}"}}]}`))
	}))
	defer server.Close()

	generate := OpenAICompatible(OpenAICompatibleOptions{
		Model:   "openai/gpt-6-luna",
		BaseURL: server.URL + "/v1",
		APIKey:  "test-key",
		ExtraBody: map[string]any{
			"model": "should-not-win",
			"seed":  42,
			"providerOptions": map[string]any{
				"gateway": map[string]any{
					"user": "user-12345",
					"tags": []string{"team:billing"},
				},
			},
		},
	})
	params := StructuredGenerateParams(LLMStructuredGenerateParams{
		Messages: []LLMMessage{{Role: LLMRoleUser, Content: LLMMessageContent{
			TextContentBlock(LLMTextContent{Text: "hello"}),
		}}},
		ResponseFormat: LLMJSONSchemaResponseFormat{Name: "answer", Schema: json.RawMessage(`{"type":"object"}`)},
	})
	result, err := generate(context.Background(), params)
	if err != nil {
		t.Fatal(err)
	}
	structured, ok := result.AsStructured()
	if !ok || string(structured.StructuredContent) != `{"ok":true}` {
		t.Fatalf("unexpected result: %#v", result)
	}
	if request.Model != "openai/gpt-6-luna" {
		t.Fatalf("expected configured model, got %s", request.Model)
	}
	if request.Seed != 42 {
		t.Fatalf("expected seed 42, got %d", request.Seed)
	}
	if request.ProviderOptions == nil {
		t.Fatal("expected providerOptions to be present")
	}
}

func TestOpenAICompatibleLive(t *testing.T) {
	apiKey := os.Getenv("AI_GATEWAY_API_KEY")
	if apiKey == "" {
		t.Skip("AI_GATEWAY_API_KEY not set")
	}
	baseURL := os.Getenv("AI_GATEWAY_BASE_URL")
	if baseURL == "" {
		baseURL = "https://ai-gateway.vercel.sh/v1"
	}
	model := os.Getenv("AI_GATEWAY_MODEL")
	if model == "" {
		model = "openai/gpt-6-luna"
	}

	generate := OpenAICompatible(OpenAICompatibleOptions{
		Model:   model,
		BaseURL: baseURL,
		APIKey:  apiKey,
		ExtraBody: map[string]any{
			"providerOptions": map[string]any{
				"gateway": map[string]any{
					"user": "go-smoke-test-user",
					"tags": []string{"smoke:go", "test:live-luna"},
				},
			},
		},
	})

	params := StructuredGenerateParams(LLMStructuredGenerateParams{
		Messages: []LLMMessage{{
			Role: LLMRoleUser,
			Content: LLMMessageContent{
				TextContentBlock(LLMTextContent{Text: "What is 4 + 4? Return JSON with key result."}),
			},
		}},
		ResponseFormat: LLMJSONSchemaResponseFormat{
			Name: "math",
			Schema: json.RawMessage(`{
				"type": "object",
				"properties": {"result": {"type": "number"}},
				"required": ["result"],
				"additionalProperties": false
			}`),
		},
	})

	result, err := generate(context.Background(), params)
	if err != nil {
		t.Fatalf("live generate failed: %v", err)
	}
	structured, ok := result.AsStructured()
	if !ok {
		t.Fatalf("expected structured result, got: %#v", result)
	}
	var decoded struct {
		Result float64 `json:"result"`
	}
	if err := json.Unmarshal(structured.StructuredContent, &decoded); err != nil {
		t.Fatalf("failed to decode result: %v", err)
	}
	if decoded.Result != 8 {
		t.Fatalf("expected result 8, got %v", decoded.Result)
	}
}
