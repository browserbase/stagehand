package stagehand

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"

	"github.com/browserbase/stagehand/packages/sdk-go/v4/internal/extensionassets"
)

type browserbaseSessionClientOptions struct {
	api     browserbaseAPI
	archive func() []byte
	http    browserbaseHTTPClientOptions
}

type browserbaseSessionClient struct {
	api     browserbaseAPI
	archive func() []byte
}

type browserbaseSessionConnection struct {
	sessionID string
	cdpURL    string
	region    *BrowserbaseRegion
	close     func(context.Context) error
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
	archive := options.archive
	if archive == nil {
		archive = extensionassets.Archive
	}
	return &browserbaseSessionClient{api: api, archive: archive}, nil
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

	callerExtensionID, callerHasExtension := browserbaseCallerExtensionID(params)
	requestExtensionID := callerExtensionID
	if !callerHasExtension {
		pendingExtensionID := "pending-stagehand-extension"
		requestExtensionID = &pendingExtensionID
	}
	request, err := newBrowserbaseCreateSessionRequest(params, requestExtensionID)
	if err != nil {
		return resolvedBrowserSource{}, fmt.Errorf("build Browserbase session request: %w", err)
	}
	if request.UserMetadata == nil {
		request.UserMetadata = make(map[string]json.RawMessage, 3)
	}
	request.UserMetadata["stagehand"] = json.RawMessage(`"true"`)
	request.UserMetadata["stagehand_sdk_language"] = json.RawMessage(`"go"`)
	request.UserMetadata["stagehand_sdk_version"] = json.RawMessage(`"` + stagehandSDKVersion + `"`)
	extensionID := ""
	ownsExtension := !callerHasExtension
	if ownsExtension {
		archive := client.archive()
		if len(archive) == 0 {
			return resolvedBrowserSource{}, errors.New(
				"bundled Stagehand extension archive is empty",
			)
		}
		extension, err := client.api.uploadExtension(ctx, archive)
		if err != nil {
			return resolvedBrowserSource{}, fmt.Errorf(
				"upload Stagehand extension to Browserbase: %w",
				err,
			)
		}
		if err := extension.validate(); err != nil {
			return resolvedBrowserSource{}, fmt.Errorf(
				"validate Browserbase extension upload: %w",
				err,
			)
		}
		extensionID = strings.TrimSpace(*extension.ID)
		if extensionID == "" {
			return resolvedBrowserSource{}, errors.New(
				"Browserbase extension upload returned an empty extension ID",
			)
		}
		request.ExtensionID = &extensionID
	}
	session, err := client.api.createSession(ctx, request)
	if err != nil {
		return resolvedBrowserSource{}, errors.Join(
			errors.New("failed to create a Browserbase session"),
			client.deleteExtensionBestEffort(
				context.WithoutCancel(ctx),
				extensionID,
				ownsExtension,
			),
		)
	}
	if err := session.validate(); err != nil {
		sessionID := ""
		if session.ID != nil {
			sessionID = strings.TrimSpace(*session.ID)
		}
		return resolvedBrowserSource{}, errors.Join(
			errors.New("failed to create a Browserbase session"),
			client.cleanupInvalidSession(
				context.WithoutCancel(ctx),
				sessionID,
				extensionID,
				ownsExtension,
			),
		)
	}

	sessionID := strings.TrimSpace(*session.ID)
	cdpURL := strings.TrimSpace(*session.ConnectURL)
	if sessionID == "" || cdpURL == "" {
		cleanupErr := client.cleanupInvalidSession(
			context.WithoutCancel(ctx),
			sessionID,
			extensionID,
			ownsExtension,
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
		api:           client.api,
		sessionID:     sessionID,
		extensionID:   extensionID,
		ownsExtension: ownsExtension,
	}
	return resolvedBrowserSource{
		cdpURL:               cdpURL,
		browserbaseSessionID: sessionID,
		close:                resources.close,
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
	resources := &browserbaseSessionResources{
		api:       client.api,
		sessionID: strings.TrimSpace(*session.ID),
	}
	return browserbaseSessionConnection{
		sessionID: strings.TrimSpace(*session.ID),
		cdpURL:    cdpURL,
		region:    session.Region,
		close:     resources.close,
	}, nil
}

func browserbaseCallerExtensionID(params BrowserbaseLaunchOptions) (*string, bool) {
	if params.ExtensionID != nil {
		return params.ExtensionID, true
	}
	if params.BrowserSettings != nil &&
		params.BrowserSettings.ExtensionID != nil {
		return nil, true
	}
	return nil, false
}

func (client *browserbaseSessionClient) cleanupInvalidSession(
	ctx context.Context,
	sessionID string,
	extensionID string,
	ownsExtension bool,
) error {
	var releaseErr error
	if sessionID != "" {
		if _, err := client.api.releaseSession(ctx, sessionID); err != nil {
			releaseErr = errors.New(
				"failed to release the Browserbase session after a session failure",
			)
		}
	}
	var deleteErr error
	if ownsExtension {
		if err := client.api.deleteExtension(ctx, extensionID); err != nil {
			deleteErr = errors.New(
				"failed to delete the Browserbase extension after a session failure",
			)
		}
	}
	return errors.Join(releaseErr, deleteErr)
}

func (client *browserbaseSessionClient) deleteExtensionBestEffort(
	ctx context.Context,
	extensionID string,
	ownsExtension bool,
) error {
	if !ownsExtension {
		return nil
	}
	if err := client.api.deleteExtension(ctx, extensionID); err != nil {
		return errors.New(
			"failed to delete the Browserbase extension after a session failure",
		)
	}
	return nil
}

type browserbaseSessionResources struct {
	api           browserbaseAPI
	sessionID     string
	extensionID   string
	ownsExtension bool

	mu               sync.Mutex
	sessionReleased  bool
	extensionDeleted bool
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

	var extensionErr error
	if resources.ownsExtension && !resources.extensionDeleted {
		if err := resources.api.deleteExtension(ctx, resources.extensionID); err != nil {
			extensionErr = err
		} else {
			resources.extensionDeleted = true
		}
	}
	return errors.Join(releaseErr, extensionErr)
}
