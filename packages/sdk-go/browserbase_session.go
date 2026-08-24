package stagehand

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
)

type browserbaseSessionClientOptions struct {
	api  browserbaseAPI
	http browserbaseHTTPClientOptions
}

type browserbaseSessionClient struct {
	api browserbaseAPI
}

type browserbaseSessionConnection struct {
	sessionID string
	cdpURL    string
	region    *BrowserbaseRegion
}

func newBrowserbaseSessionClient(
	apiKey string,
	options browserbaseSessionClientOptions,
) (*browserbaseSessionClient, error) {
	api := options.api
	if api == nil {
		httpClient, err := newBrowserbaseHTTPClient(apiKey, options.http)
		if err != nil {
			return nil, err
		}
		api = httpClient
	}
	return &browserbaseSessionClient{api: api}, nil
}

func (client *browserbaseSessionClient) createSession(
	ctx context.Context,
	params BrowserbaseLaunchOptions,
) (resolvedBrowserSource, error) {
	if ctx == nil {
		return resolvedBrowserSource{}, errors.New(
			"stagehand Browserbase session context is required",
		)
	}

	request, err := newBrowserbaseCreateSessionRequest(
		withStagehandBrowserbaseExtension(params),
	)
	if err != nil {
		return resolvedBrowserSource{}, fmt.Errorf("build Browserbase session request: %w", err)
	}
	if request.UserMetadata == nil {
		request.UserMetadata = make(map[string]json.RawMessage, 3)
	}
	request.UserMetadata["stagehand"] = json.RawMessage(`"true"`)
	request.UserMetadata["stagehand_sdk_language"] = json.RawMessage(`"go"`)
	request.UserMetadata["stagehand_sdk_version"] = json.RawMessage(`"` + stagehandSDKVersion + `"`)
	session, err := client.api.createSession(ctx, request)
	if err != nil {
		return resolvedBrowserSource{}, errors.New("failed to create a Browserbase session")
	}
	if err := session.validate(); err != nil {
		sessionID := ""
		if session.ID != nil {
			sessionID = strings.TrimSpace(*session.ID)
		}
		return resolvedBrowserSource{}, errors.Join(
			errors.New("failed to create a Browserbase session"),
			client.cleanupInvalidSession(context.WithoutCancel(ctx), sessionID),
		)
	}

	sessionID := strings.TrimSpace(*session.ID)
	cdpURL := strings.TrimSpace(*session.ConnectURL)
	if sessionID == "" || cdpURL == "" {
		cleanupErr := client.cleanupInvalidSession(
			context.WithoutCancel(ctx),
			sessionID,
		)
		if sessionID == "" {
			return resolvedBrowserSource{}, errors.Join(
				errors.New("Browserbase session creation returned an empty session ID"),
				cleanupErr,
			)
		}
		return resolvedBrowserSource{}, errors.Join(
			errors.New("Browserbase session creation returned an empty connection URL"),
			cleanupErr,
		)
	}
	resources := &browserbaseSessionResources{
		api:       client.api,
		sessionID: sessionID,
	}
	return resolvedBrowserSource{
		cdpURL:                    cdpURL,
		browserbaseSessionID:      sessionID,
		residentBrowserConnection: true,
		close:                     resources.close,
	}, nil
}

func (client *browserbaseSessionClient) connectSession(
	ctx context.Context,
	sessionID string,
) (browserbaseSessionConnection, error) {
	if ctx == nil {
		return browserbaseSessionConnection{}, errors.New(
			"stagehand Browserbase session context is required",
		)
	}
	normalizedSessionID := strings.TrimSpace(sessionID)
	if normalizedSessionID == "" {
		return browserbaseSessionConnection{}, errors.New(
			"stagehand Browserbase session ID is required",
		)
	}
	session, err := client.api.retrieveSession(ctx, normalizedSessionID)
	if err != nil {
		return browserbaseSessionConnection{}, errors.New(
			"failed to retrieve the Browserbase session",
		)
	}
	if err := session.validate(); err != nil {
		return browserbaseSessionConnection{}, errors.New(
			"failed to retrieve the Browserbase session",
		)
	}
	cdpURL := ""
	if session.ConnectURL != nil {
		cdpURL = strings.TrimSpace(*session.ConnectURL)
	}
	if cdpURL == "" {
		return browserbaseSessionConnection{}, errors.New(
			"Browserbase session is not available for connection",
		)
	}
	return browserbaseSessionConnection{
		sessionID: strings.TrimSpace(*session.ID),
		cdpURL:    cdpURL,
		region:    session.Region,
	}, nil
}

func (client *browserbaseSessionClient) cleanupInvalidSession(
	ctx context.Context,
	sessionID string,
) error {
	var releaseErr error
	if sessionID != "" {
		if _, err := client.api.releaseSession(ctx, sessionID); err != nil {
			releaseErr = errors.New(
				"failed to release the Browserbase session after a session failure",
			)
		}
	}
	return releaseErr
}

type browserbaseSessionResources struct {
	api       browserbaseAPI
	sessionID string

	mu              sync.Mutex
	sessionReleased bool
}

func (resources *browserbaseSessionResources) close(ctx context.Context) error {
	if ctx == nil {
		return errors.New("stagehand Browserbase close context is required")
	}

	resources.mu.Lock()
	defer resources.mu.Unlock()

	var releaseErr error
	if !resources.sessionReleased {
		if _, err := resources.api.releaseSession(ctx, resources.sessionID); err != nil {
			releaseErr = err
		} else {
			resources.sessionReleased = true
		}
	}

	return releaseErr
}

func withStagehandBrowserbaseExtension(params BrowserbaseLaunchOptions) BrowserbaseLaunchOptions {
	settings := BrowserbaseBrowserSettings{}
	if params.BrowserSettings != nil {
		settings = *params.BrowserSettings
	}
	seen := make(map[BrowserbaseExtension]struct{}, len(settings.Extensions)+1)
	extensions := make([]BrowserbaseExtension, 0, len(settings.Extensions)+1)
	for _, extension := range settings.Extensions {
		if _, exists := seen[extension]; exists {
			continue
		}
		seen[extension] = struct{}{}
		extensions = append(extensions, extension)
	}
	if _, exists := seen[BrowserbaseExtensionStagehand]; !exists {
		extensions = append(extensions, BrowserbaseExtensionStagehand)
	}
	settings.Extensions = extensions
	params.BrowserSettings = &settings
	return params
}
