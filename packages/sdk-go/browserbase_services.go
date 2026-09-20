package stagehand

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"unicode/utf8"
)

// BrowserbaseSearchOptions configures a Browserbase web search.
type BrowserbaseSearchOptions struct {
	APIKey     string
	BaseURL    string
	Query      string
	NumResults *int
}

// BrowserbaseSearchResult contains Browserbase web search results.
type BrowserbaseSearchResult struct {
	Query     string                        `json:"query"`
	RequestID string                        `json:"requestId"`
	Results   []BrowserbaseSearchResultItem `json:"results"`
}

// BrowserbaseSearchResultItem is one Browserbase web search result.
type BrowserbaseSearchResultItem struct {
	ID            string  `json:"id"`
	Title         string  `json:"title"`
	URL           string  `json:"url"`
	Author        *string `json:"author,omitempty"`
	Favicon       *string `json:"favicon,omitempty"`
	Image         *string `json:"image,omitempty"`
	PublishedDate *string `json:"publishedDate,omitempty"`
}

// BrowserbaseFetchFormat selects the content representation returned by Browserbase Fetch.
type BrowserbaseFetchFormat string

const (
	BrowserbaseFetchFormatRaw      BrowserbaseFetchFormat = "raw"
	BrowserbaseFetchFormatJSON     BrowserbaseFetchFormat = "json"
	BrowserbaseFetchFormatMarkdown BrowserbaseFetchFormat = "markdown"
)

// BrowserbaseFetchOptions configures a Browserbase Fetch request.
type BrowserbaseFetchOptions struct {
	APIKey           string
	BaseURL          string
	URL              string
	AllowInsecureSSL *bool
	AllowRedirects   *bool
	Format           BrowserbaseFetchFormat
	Proxies          *bool
	Schema           map[string]any
}

type browserbaseFetchContentKind uint8

const (
	browserbaseFetchContentUnset browserbaseFetchContentKind = iota
	browserbaseFetchContentString
	browserbaseFetchContentObject
)

// BrowserbaseFetchContent is either string content for raw and markdown
// responses or an object for JSON responses.
type BrowserbaseFetchContent struct {
	kind   browserbaseFetchContentKind
	text   string
	object map[string]any
}

// AsString returns the string content variant, if present.
func (content BrowserbaseFetchContent) AsString() (string, bool) {
	return content.text, content.kind == browserbaseFetchContentString
}

// AsObject returns a copy of the object content variant, if present.
func (content BrowserbaseFetchContent) AsObject() (map[string]any, bool) {
	if content.kind != browserbaseFetchContentObject {
		return nil, false
	}
	result := make(map[string]any, len(content.object))
	for key, item := range content.object {
		result[key] = item
	}
	return result, true
}

// MarshalJSON implements json.Marshaler.
func (content BrowserbaseFetchContent) MarshalJSON() ([]byte, error) {
	switch content.kind {
	case browserbaseFetchContentString:
		return json.Marshal(content.text)
	case browserbaseFetchContentObject:
		return json.Marshal(content.object)
	default:
		return nil, errors.New("stagehand.BrowserbaseFetchContent is unset")
	}
}

// UnmarshalJSON implements json.Unmarshaler.
func (content *BrowserbaseFetchContent) UnmarshalJSON(data []byte) error {
	if content == nil {
		return errors.New("stagehand.BrowserbaseFetchContent: UnmarshalJSON on nil pointer")
	}
	switch firstJSONByte(data) {
	case '"':
		var value string
		if err := json.Unmarshal(data, &value); err != nil {
			return fmt.Errorf("decode Browserbase fetch string content: %w", err)
		}
		*content = BrowserbaseFetchContent{kind: browserbaseFetchContentString, text: value}
		return nil
	case '{':
		var value map[string]any
		if err := json.Unmarshal(data, &value); err != nil {
			return fmt.Errorf("decode Browserbase fetch object content: %w", err)
		}
		*content = BrowserbaseFetchContent{kind: browserbaseFetchContentObject, object: value}
		return nil
	default:
		return errors.New("decode Browserbase fetch content: expected string or object")
	}
}

// BrowserbaseFetchResult contains content and response metadata returned by Browserbase Fetch.
type BrowserbaseFetchResult struct {
	ID          string                  `json:"id"`
	Content     BrowserbaseFetchContent `json:"content"`
	ContentType string                  `json:"contentType"`
	Encoding    string                  `json:"encoding"`
	Headers     map[string]string       `json:"headers"`
	StatusCode  int                     `json:"statusCode"`
}

// SearchBrowserbase performs a Browserbase web search.
func SearchBrowserbase(ctx context.Context, options BrowserbaseSearchOptions) (BrowserbaseSearchResult, error) {
	client, err := newBrowserbaseHTTPClient(options.APIKey, browserbaseHTTPClientOptions{
		baseURL: options.BaseURL,
	})
	if err != nil {
		return BrowserbaseSearchResult{}, err
	}
	response, err := sendBrowserbaseRequest[browserbaseSearchResponse](
		ctx,
		client,
		browserbaseSearchRequest{Query: options.Query, NumResults: options.NumResults},
	)
	if err != nil {
		return BrowserbaseSearchResult{}, err
	}
	return response.result(), nil
}

// FetchBrowserbase fetches a URL through Browserbase.
func FetchBrowserbase(ctx context.Context, options BrowserbaseFetchOptions) (BrowserbaseFetchResult, error) {
	client, err := newBrowserbaseHTTPClient(options.APIKey, browserbaseHTTPClientOptions{
		baseURL: options.BaseURL,
	})
	if err != nil {
		return BrowserbaseFetchResult{}, err
	}
	var schema *map[string]any
	if options.Schema != nil {
		schema = &options.Schema
	}
	response, err := sendBrowserbaseRequest[browserbaseFetchResponse](
		ctx,
		client,
		browserbaseFetchRequest{
			URL: options.URL, AllowInsecureSSL: options.AllowInsecureSSL,
			AllowRedirects: options.AllowRedirects, Format: options.Format,
			Proxies: options.Proxies, Schema: schema,
		},
	)
	if err != nil {
		return BrowserbaseFetchResult{}, err
	}
	return response.result()
}

type browserbaseSearchRequest struct {
	Query      string `json:"query"`
	NumResults *int   `json:"numResults,omitempty"`
}

func (request browserbaseSearchRequest) encode() (browserbaseEncodedRequest, error) {
	encoded := browserbaseEncodedRequest{
		method: http.MethodPost, path: "/v1/search",
	}
	if strings.TrimSpace(request.Query) == "" {
		return encoded, errors.New("query is required")
	}
	if utf8.RuneCountInString(request.Query) > 200 {
		return encoded, errors.New("query must be at most 200 characters")
	}
	if request.NumResults != nil && (*request.NumResults < 1 || *request.NumResults > 25) {
		return encoded, errors.New("numResults must be between 1 and 25")
	}
	body, err := json.Marshal(request)
	if err != nil {
		return encoded, fmt.Errorf("encode search request: %w", err)
	}
	encoded.body = body
	encoded.contentType = "application/json"
	return encoded, nil
}

type browserbaseSearchResponse struct {
	Query     *string                          `json:"query"`
	RequestID *string                          `json:"requestId"`
	Results   *[]browserbaseSearchResponseItem `json:"results"`
}

type browserbaseSearchResponseItem struct {
	ID            *string `json:"id"`
	Title         *string `json:"title"`
	URL           *string `json:"url"`
	Author        *string `json:"author,omitempty"`
	Favicon       *string `json:"favicon,omitempty"`
	Image         *string `json:"image,omitempty"`
	PublishedDate *string `json:"publishedDate,omitempty"`
}

func (response browserbaseSearchResponse) validate() error {
	if err := requireBrowserbaseResponseFields(map[string]bool{
		"query":     response.Query != nil,
		"requestId": response.RequestID != nil,
		"results":   response.Results != nil,
	}); err != nil {
		return err
	}
	for index, result := range *response.Results {
		if err := requireBrowserbaseResponseFields(map[string]bool{
			"id": result.ID != nil, "title": result.Title != nil, "url": result.URL != nil,
		}); err != nil {
			return fmt.Errorf("search result %d: %w", index, err)
		}
	}
	return nil
}

func (response browserbaseSearchResponse) result() BrowserbaseSearchResult {
	results := make([]BrowserbaseSearchResultItem, len(*response.Results))
	for index, result := range *response.Results {
		results[index] = BrowserbaseSearchResultItem{
			ID: *result.ID, Title: *result.Title, URL: *result.URL,
			Author: result.Author, Favicon: result.Favicon, Image: result.Image,
			PublishedDate: result.PublishedDate,
		}
	}
	return BrowserbaseSearchResult{
		Query: *response.Query, RequestID: *response.RequestID, Results: results,
	}
}

type browserbaseFetchRequest struct {
	URL              string                 `json:"url"`
	AllowInsecureSSL *bool                  `json:"allowInsecureSsl,omitempty"`
	AllowRedirects   *bool                  `json:"allowRedirects,omitempty"`
	Format           BrowserbaseFetchFormat `json:"format,omitempty"`
	Proxies          *bool                  `json:"proxies,omitempty"`
	Schema           *map[string]any        `json:"schema,omitempty"`
}

func (request browserbaseFetchRequest) encode() (browserbaseEncodedRequest, error) {
	encoded := browserbaseEncodedRequest{
		method: http.MethodPost, path: "/v1/fetch",
	}
	if err := validateBrowserbaseURL("url", request.URL, "http", "https"); err != nil {
		return encoded, err
	}
	switch request.Format {
	case "", BrowserbaseFetchFormatRaw, BrowserbaseFetchFormatJSON, BrowserbaseFetchFormatMarkdown:
	default:
		return encoded, fmt.Errorf("invalid fetch format %q", request.Format)
	}
	if request.Schema != nil && request.Format != BrowserbaseFetchFormatJSON {
		return encoded, errors.New(`schema is only valid when format is "json"`)
	}
	if request.Format == BrowserbaseFetchFormatJSON && request.Schema == nil {
		return encoded, errors.New(`schema is required when format is "json"`)
	}
	body, err := json.Marshal(request)
	if err != nil {
		return encoded, fmt.Errorf("encode fetch request: %w", err)
	}
	encoded.body = body
	encoded.contentType = "application/json"
	return encoded, nil
}

type browserbaseFetchResponse struct {
	ID          *string            `json:"id"`
	Content     *json.RawMessage   `json:"content"`
	ContentType *string            `json:"contentType"`
	Encoding    *string            `json:"encoding"`
	Headers     *map[string]string `json:"headers"`
	StatusCode  *int               `json:"statusCode"`
}

func (response browserbaseFetchResponse) validate() error {
	return requireBrowserbaseResponseFields(map[string]bool{
		"id":          response.ID != nil,
		"content":     response.Content != nil,
		"contentType": response.ContentType != nil,
		"encoding":    response.Encoding != nil,
		"headers":     response.Headers != nil,
		"statusCode":  response.StatusCode != nil,
	})
}

func (response browserbaseFetchResponse) result() (BrowserbaseFetchResult, error) {
	var content BrowserbaseFetchContent
	if err := json.Unmarshal(*response.Content, &content); err != nil {
		return BrowserbaseFetchResult{}, fmt.Errorf("decode Browserbase fetch content: %w", err)
	}
	return BrowserbaseFetchResult{
		ID: *response.ID, Content: content, ContentType: *response.ContentType,
		Encoding: *response.Encoding, Headers: *response.Headers, StatusCode: *response.StatusCode,
	}, nil
}
