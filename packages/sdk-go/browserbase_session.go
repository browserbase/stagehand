package stagehand

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"

	"github.com/browserbase/stagehand/packages/sdk-go/internal/extensionassets"
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
	params BrowserbaseClientBrowserSource,
) (resolvedBrowserSource, error) {
	if ctx == nil {
		return resolvedBrowserSource{}, errors.New(
			"stagehand Browserbase session context is required",
		)
	}

	request, err := newBrowserbaseCreateSessionRequest(params, "pending-stagehand-extension")
	if err != nil {
		return resolvedBrowserSource{}, fmt.Errorf("build Browserbase session request: %w", err)
	}
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
	extensionID := strings.TrimSpace(*extension.ID)
	if extensionID == "" {
		return resolvedBrowserSource{}, errors.New(
			"Browserbase extension upload returned an empty extension ID",
		)
	}

	request.ExtensionID = &extensionID
	session, err := client.api.createSession(ctx, request)
	if err != nil {
		return resolvedBrowserSource{}, errors.Join(
			fmt.Errorf("create Browserbase session: %w", err),
			client.deleteExtensionBestEffort(ctx, extensionID),
		)
	}
	if err := session.validate(); err != nil {
		sessionID := ""
		if session.ID != nil {
			sessionID = strings.TrimSpace(*session.ID)
		}
		return resolvedBrowserSource{}, errors.Join(
			fmt.Errorf("validate Browserbase session: %w", err),
			client.cleanupInvalidSession(ctx, sessionID, extensionID),
		)
	}

	sessionID := strings.TrimSpace(*session.ID)
	cdpURL := strings.TrimSpace(*session.ConnectURL)
	if sessionID == "" || cdpURL == "" {
		cleanupErr := client.cleanupInvalidSession(ctx, sessionID, extensionID)
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
		api:         client.api,
		sessionID:   sessionID,
		extensionID: extensionID,
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
	extensionID string,
) error {
	var releaseErr error
	if sessionID != "" {
		_, releaseErr = client.api.releaseSession(ctx, sessionID)
	}
	deleteErr := client.api.deleteExtension(ctx, extensionID)
	return errors.Join(releaseErr, deleteErr)
}

func (client *browserbaseSessionClient) deleteExtensionBestEffort(
	ctx context.Context,
	extensionID string,
) error {
	if err := client.api.deleteExtension(ctx, extensionID); err != nil {
		return fmt.Errorf("delete Browserbase extension after failure: %w", err)
	}
	return nil
}

type browserbaseSessionResources struct {
	api         browserbaseAPI
	sessionID   string
	extensionID string

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
	if !resources.extensionDeleted {
		if err := resources.api.deleteExtension(ctx, resources.extensionID); err != nil {
			extensionErr = err
		} else {
			resources.extensionDeleted = true
		}
	}
	return errors.Join(releaseErr, extensionErr)
}
