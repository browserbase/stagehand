package stagehand

import (
	"errors"
	"net/url"
	"strings"
)

type browserbaseConnection struct {
	apiKey    string
	apiURL    string
	sessionID string
}

// resolveBrowserbaseConnection snapshots the effective Gateway/cache connection settings.
func resolveBrowserbaseConnection(options CreateOptions, claimed claimedBrowser) (*browserbaseConnection, error) {
	apiKey := options.APIKey
	if claimed.workerAPIKey != nil {
		apiKey = claimed.workerAPIKey
	}
	browser := claimed.workerBrowser
	if apiKey == nil || *apiKey == "" || browser == nil || browser.SessionID == "" {
		return nil, nil
	}

	var baseURL string
	if options.APIURL != nil {
		baseURL = *options.APIURL
	} else {
		region := BrowserbaseRegionUSWest2
		if browser.Region != nil {
			region = *browser.Region
		}
		switch region {
		case BrowserbaseRegionUSWest2:
			baseURL = "https://api.stagehand.browserbase.com"
		case BrowserbaseRegionUSEast1:
			baseURL = "https://api.use1.stagehand.browserbase.com"
		case BrowserbaseRegionEUCentral1:
			baseURL = "https://api.euc1.stagehand.browserbase.com"
		case BrowserbaseRegionAPSoutheast1:
			baseURL = "https://api.apse1.stagehand.browserbase.com"
		default:
			return nil, errors.New("unsupported Browserbase region")
		}
	}
	return &browserbaseConnection{
		apiKey:    *apiKey,
		apiURL:    strings.TrimRight(baseURL, "/") + "/v1",
		sessionID: browser.SessionID,
	}, nil
}

func validateBrowserbaseCreateOptions(options CreateOptions, claimed claimedBrowser) error {
	apiKey := options.APIKey
	if claimed.workerAPIKey != nil {
		apiKey = claimed.workerAPIKey
	}
	if apiKey != nil && *apiKey == "" {
		return errors.New("stagehand: APIKey must not be empty")
	}
	if options.APIURL == nil {
		return nil
	}
	value := *options.APIURL
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme == "" || ((parsed.Scheme == "http" || parsed.Scheme == "https") && parsed.Host == "") {
		return errors.New("stagehand: APIURL must be a valid URL")
	}
	if strings.ContainsAny(value, "?#") {
		return errors.New("stagehand: APIURL must not include a query string or fragment")
	}
	if strings.HasSuffix(strings.TrimRight(parsed.EscapedPath(), "/"), "/v1") {
		return errors.New("stagehand: APIURL must be a service origin without /v1")
	}
	return nil
}
