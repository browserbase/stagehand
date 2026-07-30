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
	params BrowserbaseClientBrowserSource,
) (resolvedBrowserSource, error) {
	if ctx == nil {
		return resolvedBrowserSource{}, errors.New(
			"stagehand Browserbase session context is required",
		)
	}

	request, err := newBrowserbaseCreateSessionRequest(withStagehandBrowserbaseExtension(params))
	if err != nil {
		return resolvedBrowserSource{}, fmt.Errorf("build Browserbase session request: %w", err)
	}
	if request.UserMetadata == nil {
		request.UserMetadata = make(map[string]json.RawMessage, 2)
	}
	request.UserMetadata["stagehand"] = json.RawMessage(`"true"`)
	request.UserMetadata["stagehand_sdk_language"] = json.RawMessage(`"go"`)
	session, err := client.api.createSession(ctx, request)
	if err != nil {
		return resolvedBrowserSource{}, fmt.Errorf("create Browserbase session: %w", err)
	}
	if err := session.validate(); err != nil {
		sessionID := ""
		if session.ID != nil {
			sessionID = strings.TrimSpace(*session.ID)
		}
		return resolvedBrowserSource{}, errors.Join(
			fmt.Errorf("validate Browserbase session: %w", err),
			client.cleanupInvalidSession(ctx, sessionID),
		)
	}

	sessionID := strings.TrimSpace(*session.ID)
	cdpURL := strings.TrimSpace(*session.ConnectURL)
	if sessionID == "" || cdpURL == "" {
		cleanupErr := client.cleanupInvalidSession(ctx, sessionID)
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
	keepAlive := params.KeepAlive != nil && *params.KeepAlive
	return resolvedBrowserSource{
		cdpURL:               cdpURL,
		browserbaseSessionID: sessionID,
		keepAlive:            keepAlive,
		close:                resources.close,
	}, nil
}

func (client *browserbaseSessionClient) cleanupInvalidSession(
	ctx context.Context,
	sessionID string,
) error {
	if sessionID == "" {
		return nil
	}
	_, err := client.api.releaseSession(ctx, sessionID)
	return err
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

func withStagehandBrowserbaseExtension(
	params BrowserbaseClientBrowserSource,
) BrowserbaseClientBrowserSource {
	settings := BrowserbaseBrowserSettings{}
	if params.BrowserSettings != nil {
		settings = *params.BrowserSettings
	}
	extensions := make([]BrowserbaseExtension, 0, len(settings.Extensions)+1)
	seen := make(map[BrowserbaseExtension]struct{}, len(settings.Extensions)+1)
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
