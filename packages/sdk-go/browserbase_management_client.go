package stagehand

import "net/http"

type BrowserbaseClientOptions struct {
	APIKey     string
	BaseURL    string
	HTTPClient *http.Client
	MaxRetries *int
}

type BrowserbaseClient struct {
	api *browserbaseHTTPClient
}

func NewBrowserbaseClient(options BrowserbaseClientOptions) (*BrowserbaseClient, error) {
	api, err := newBrowserbaseHTTPClient(options.APIKey, browserbaseHTTPClientOptions{
		baseURL: options.BaseURL, httpClient: options.HTTPClient, maxRetries: options.MaxRetries,
	})
	if err != nil {
		return nil, err
	}
	return &BrowserbaseClient{api: api}, nil
}
