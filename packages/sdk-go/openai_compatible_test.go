package stagehand

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestOpenAICompatible(t *testing.T) {
	var request struct {
		Model    string `json:"model"`
		Messages []struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		} `json:"messages"`
		ResponseFormat struct {
			Type string `json:"type"`
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
}
