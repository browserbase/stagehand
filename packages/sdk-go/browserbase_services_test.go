package stagehand

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
)

func TestBrowserbaseSearchAndFetch(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Header.Get("X-BB-API-Key") != "bb_test" {
			t.Errorf("X-BB-API-Key = %q", request.Header.Get("X-BB-API-Key"))
		}
		var body map[string]any
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Errorf("decode request: %v", err)
			writer.WriteHeader(http.StatusBadRequest)
			return
		}
		switch request.URL.Path {
		case "/v1/search":
			want := map[string]any{"query": "browser agents", "numResults": float64(5)}
			if !reflect.DeepEqual(body, want) {
				t.Errorf("search body = %#v, want %#v", body, want)
			}
			writeBrowserbaseTestJSON(writer, map[string]any{
				"query":     "browser agents",
				"requestId": "request_123",
				"results": []map[string]any{{
					"id": "result_123", "title": "Stagehand", "url": "https://stagehand.dev",
				}},
			})
		case "/v1/fetch":
			want := map[string]any{"url": "https://stagehand.dev", "format": "markdown"}
			if !reflect.DeepEqual(body, want) {
				t.Errorf("fetch body = %#v, want %#v", body, want)
			}
			writeBrowserbaseTestJSON(writer, map[string]any{
				"id": "fetch_123", "content": "# Stagehand", "contentType": "text/markdown",
				"encoding": "utf-8", "headers": map[string]string{"content-type": "text/html"},
				"statusCode": 200,
			})
		default:
			http.Error(writer, "unexpected endpoint", http.StatusNotFound)
		}
	}))
	defer server.Close()

	numResults := 5
	search, err := SearchBrowserbase(context.Background(), BrowserbaseSearchOptions{
		APIKey: "bb_test", BaseURL: server.URL, Query: "browser agents", NumResults: &numResults,
	})
	if err != nil {
		t.Fatalf("SearchBrowserbase() error = %v", err)
	}
	if search.RequestID != "request_123" || len(search.Results) != 1 {
		t.Fatalf("SearchBrowserbase() = %#v", search)
	}

	fetch, err := FetchBrowserbase(context.Background(), BrowserbaseFetchOptions{
		APIKey: "bb_test", BaseURL: server.URL, URL: "https://stagehand.dev",
		Format: BrowserbaseFetchFormatMarkdown,
	})
	if err != nil {
		t.Fatalf("FetchBrowserbase() error = %v", err)
	}
	content, stringContent := fetch.Content.AsString()
	if fetch.StatusCode != 200 || !stringContent || content != "# Stagehand" {
		t.Fatalf("FetchBrowserbase() = %#v", fetch)
	}
}

func TestBrowserbaseSearchAndFetchValidateOptions(t *testing.T) {
	zero := 0
	if _, err := SearchBrowserbase(context.Background(), BrowserbaseSearchOptions{
		APIKey: "bb_test", Query: "browser agents", NumResults: &zero,
	}); err == nil {
		t.Fatal("SearchBrowserbase() expected numResults error")
	}
	if _, err := SearchBrowserbase(context.Background(), BrowserbaseSearchOptions{
		APIKey: "bb_test", Query: strings.Repeat("q", 201),
	}); err == nil || !strings.Contains(err.Error(), "at most 200 characters") {
		t.Fatalf("SearchBrowserbase() error = %v, want query length error", err)
	}
	if _, err := FetchBrowserbase(context.Background(), BrowserbaseFetchOptions{
		APIKey: "bb_test", URL: "https://stagehand.dev", Format: "xml",
	}); err == nil {
		t.Fatal("FetchBrowserbase() expected format error")
	}
	if _, err := FetchBrowserbase(context.Background(), BrowserbaseFetchOptions{
		APIKey: "bb_test", URL: "https://stagehand.dev",
		Format: BrowserbaseFetchFormatMarkdown, Schema: map[string]any{"type": "object"},
	}); err == nil || !strings.Contains(err.Error(), `schema is only valid when format is "json"`) {
		t.Fatalf("FetchBrowserbase() error = %v, want schema format error", err)
	}
	if _, err := FetchBrowserbase(context.Background(), BrowserbaseFetchOptions{
		APIKey: "bb_test", URL: "https://stagehand.dev", Format: BrowserbaseFetchFormatJSON,
	}); err == nil || !strings.Contains(err.Error(), `schema is required when format is "json"`) {
		t.Fatalf("FetchBrowserbase() error = %v, want required schema error", err)
	}
}

func TestBrowserbaseFetchContentVariants(t *testing.T) {
	var stringContent BrowserbaseFetchContent
	if err := json.Unmarshal([]byte(`"# Stagehand"`), &stringContent); err != nil {
		t.Fatalf("decode string content: %v", err)
	}
	if value, ok := stringContent.AsString(); !ok || value != "# Stagehand" {
		t.Fatalf("AsString() = %q, %t", value, ok)
	}
	if _, ok := stringContent.AsObject(); ok {
		t.Fatal("AsObject() unexpectedly matched string content")
	}
	encodedString, err := json.Marshal(stringContent)
	if err != nil || string(encodedString) != `"# Stagehand"` {
		t.Fatalf("MarshalJSON() = %s, %v", encodedString, err)
	}

	var objectContent BrowserbaseFetchContent
	if err := json.Unmarshal([]byte(`{"title":"Stagehand"}`), &objectContent); err != nil {
		t.Fatalf("decode object content: %v", err)
	}
	if value, ok := objectContent.AsObject(); !ok || value["title"] != "Stagehand" {
		t.Fatalf("AsObject() = %#v, %t", value, ok)
	}
	if _, ok := objectContent.AsString(); ok {
		t.Fatal("AsString() unexpectedly matched object content")
	}
	encodedObject, err := json.Marshal(objectContent)
	if err != nil || string(encodedObject) != `{"title":"Stagehand"}` {
		t.Fatalf("MarshalJSON() = %s, %v", encodedObject, err)
	}

	for _, invalid := range []string{`null`, `[]`, `42`, `true`} {
		var content BrowserbaseFetchContent
		if err := json.Unmarshal([]byte(invalid), &content); err == nil {
			t.Fatalf("UnmarshalJSON(%s) expected error", invalid)
		}
	}
}

func TestBrowserbaseSearchAndFetchAreNotReplaySafe(t *testing.T) {
	search, err := (browserbaseSearchRequest{Query: "browser agents"}).encode()
	if err != nil {
		t.Fatalf("encode search: %v", err)
	}
	fetch, err := (browserbaseFetchRequest{URL: "https://stagehand.dev"}).encode()
	if err != nil {
		t.Fatalf("encode fetch: %v", err)
	}
	if search.replaySafe || fetch.replaySafe {
		t.Fatalf("replaySafe = search %t, fetch %t; want both false", search.replaySafe, fetch.replaySafe)
	}
}

func TestBrowserbaseSearchRejectsResultsMissingRequiredFields(t *testing.T) {
	for _, field := range []string{"id", "title", "url"} {
		t.Run(field, func(t *testing.T) {
			item := map[string]any{
				"id": "result_123", "title": "Stagehand", "url": "https://stagehand.dev",
			}
			delete(item, field)
			body, err := json.Marshal(map[string]any{
				"query": "browser agents", "requestId": "request_123", "results": []any{item},
			})
			if err != nil {
				t.Fatalf("encode response: %v", err)
			}
			var response browserbaseSearchResponse
			if err := json.Unmarshal(body, &response); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			if err := response.validate(); err == nil || !strings.Contains(err.Error(), field) {
				t.Fatalf("validate() error = %v, want missing %s error", err, field)
			}
		})
	}
}

func TestBrowserbaseFetchPreservesExplicitEmptySchema(t *testing.T) {
	schema := map[string]any{}
	encoded, err := (browserbaseFetchRequest{
		URL: "https://stagehand.dev", Format: BrowserbaseFetchFormatJSON, Schema: &schema,
	}).encode()
	if err != nil {
		t.Fatalf("encode() error = %v", err)
	}
	var body map[string]any
	if err := json.Unmarshal(encoded.body, &body); err != nil {
		t.Fatalf("decode request: %v", err)
	}
	want := map[string]any{
		"url": "https://stagehand.dev", "format": "json", "schema": map[string]any{},
	}
	if !reflect.DeepEqual(body, want) {
		t.Fatalf("fetch body = %#v, want %#v", body, want)
	}
}
