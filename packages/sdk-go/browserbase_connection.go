package stagehand

import (
	"errors"
	"strings"
)

type browserbaseConnection struct {
	apiKey    string
	apiURL    string
	sessionID string
}

// resolveBrowserbaseConnection snapshots Gateway/cache settings without changing worker initialization.
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
