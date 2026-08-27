package stagehand

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
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

// BrowserbaseFetchResult contains content and response metadata returned by Browserbase Fetch.
// Content is either a string or a map[string]any when Format is BrowserbaseFetchFormatJSON.
type BrowserbaseFetchResult struct {
	ID          string            `json:"id"`
	Content     any               `json:"content"`
	ContentType string            `json:"contentType"`
	Encoding    string            `json:"encoding"`
	Headers     map[string]string `json:"headers"`
	StatusCode  int               `json:"statusCode"`
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
	response, err := sendBrowserbaseRequest[browserbaseFetchResponse](
		ctx,
		client,
		browserbaseFetchRequest{
			URL: options.URL, AllowInsecureSSL: options.AllowInsecureSSL,
			AllowRedirects: options.AllowRedirects, Format: options.Format,
			Proxies: options.Proxies, Schema: options.Schema,
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
		method: http.MethodPost, path: "/v1/search", replaySafe: true,
	}
	if strings.TrimSpace(request.Query) == "" {
		return encoded, errors.New("query is required")
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
	Query     *string                        `json:"query"`
	RequestID *string                        `json:"requestId"`
	Results   *[]BrowserbaseSearchResultItem `json:"results"`
}

func (response browserbaseSearchResponse) validate() error {
	return requireBrowserbaseResponseFields(map[string]bool{
		"query":     response.Query != nil,
		"requestId": response.RequestID != nil,
		"results":   response.Results != nil,
	})
}

func (response browserbaseSearchResponse) result() BrowserbaseSearchResult {
	return BrowserbaseSearchResult{
		Query: *response.Query, RequestID: *response.RequestID, Results: *response.Results,
	}
}

type browserbaseFetchRequest struct {
	URL              string                 `json:"url"`
	AllowInsecureSSL *bool                  `json:"allowInsecureSsl,omitempty"`
	AllowRedirects   *bool                  `json:"allowRedirects,omitempty"`
	Format           BrowserbaseFetchFormat `json:"format,omitempty"`
	Proxies          *bool                  `json:"proxies,omitempty"`
	Schema           map[string]any         `json:"schema,omitempty"`
}

func (request browserbaseFetchRequest) encode() (browserbaseEncodedRequest, error) {
	encoded := browserbaseEncodedRequest{
		method: http.MethodPost, path: "/v1/fetch", replaySafe: true,
	}
	if err := validateBrowserbaseURL("url", request.URL, "http", "https"); err != nil {
		return encoded, err
	}
	switch request.Format {
	case "", BrowserbaseFetchFormatRaw, BrowserbaseFetchFormatJSON, BrowserbaseFetchFormatMarkdown:
	default:
		return encoded, fmt.Errorf("invalid fetch format %q", request.Format)
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
	var content any
	if err := json.Unmarshal(*response.Content, &content); err != nil {
		return BrowserbaseFetchResult{}, fmt.Errorf("decode Browserbase fetch content: %w", err)
	}
	if _, stringContent := content.(string); !stringContent {
		if _, objectContent := content.(map[string]any); !objectContent {
			return BrowserbaseFetchResult{}, errors.New("Browserbase fetch content must be a string or object")
		}
	}
	return BrowserbaseFetchResult{
		ID: *response.ID, Content: content, ContentType: *response.ContentType,
		Encoding: *response.Encoding, Headers: *response.Headers, StatusCode: *response.StatusCode,
	}, nil
}
