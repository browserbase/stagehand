package stagehand

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"
)

type fakeBrowserbaseAPI struct {
	uploadExtensionFunc func(
		context.Context,
		[]byte,
	) (browserbaseExtensionResponse, error)
	deleteExtensionFunc func(context.Context, string) error
	createSessionFunc   func(
		context.Context,
		browserbaseCreateSessionRequest,
	) (browserbaseCreateSessionResponse, error)
	releaseSessionFunc func(context.Context, string) (browserbaseSessionResponse, error)
}

func (api *fakeBrowserbaseAPI) uploadExtension(
	ctx context.Context,
	archive []byte,
) (browserbaseExtensionResponse, error) {
	if api.uploadExtensionFunc != nil {
		return api.uploadExtensionFunc(ctx, archive)
	}
	return validBrowserbaseExtensionResponse("ext_stagehand"), nil
}

func (api *fakeBrowserbaseAPI) deleteExtension(
	ctx context.Context,
	extensionID string,
) error {
	if api.deleteExtensionFunc != nil {
		return api.deleteExtensionFunc(ctx, extensionID)
	}
	return nil
}

func (api *fakeBrowserbaseAPI) createSession(
	ctx context.Context,
	request browserbaseCreateSessionRequest,
) (browserbaseCreateSessionResponse, error) {
	if api.createSessionFunc != nil {
		return api.createSessionFunc(ctx, request)
	}
	return validBrowserbaseCreateSessionResponse("session_123"), nil
}

func (api *fakeBrowserbaseAPI) releaseSession(
	ctx context.Context,
	sessionID string,
) (browserbaseSessionResponse, error) {
	if api.releaseSessionFunc != nil {
		return api.releaseSessionFunc(ctx, sessionID)
	}
	return validBrowserbaseSessionResponse(sessionID), nil
}

func TestBrowserbaseSessionClientCleansExtensionAfterCreateFailure(t *testing.T) {
	createErr := errors.New("concurrency limit reached")
	deletedExtensionID := ""
	api := &fakeBrowserbaseAPI{
		createSessionFunc: func(
			context.Context,
			browserbaseCreateSessionRequest,
		) (browserbaseCreateSessionResponse, error) {
			return browserbaseCreateSessionResponse{}, createErr
		},
		deleteExtensionFunc: func(_ context.Context, extensionID string) error {
			deletedExtensionID = extensionID
			return nil
		},
	}
	client := newBrowserbaseTestSessionClient(t, api)

	_, err := client.createSession(context.Background(), BrowserbaseClientBrowserSource{})
	if !errors.Is(err, createErr) {
		t.Fatalf("createSession() error = %v, want create error", err)
	}
	if deletedExtensionID != "ext_stagehand" {
		t.Fatalf("deleted extension = %q, want ext_stagehand", deletedExtensionID)
	}
}

func TestBrowserbaseSessionClientCleansInvalidSession(t *testing.T) {
	releasedSessionID := ""
	deletedExtensionID := ""
	response := validBrowserbaseCreateSessionResponse("session_123")
	emptyConnectionURL := " "
	response.ConnectURL = &emptyConnectionURL
	api := &fakeBrowserbaseAPI{
		createSessionFunc: func(
			context.Context,
			browserbaseCreateSessionRequest,
		) (browserbaseCreateSessionResponse, error) {
			return response, nil
		},
		releaseSessionFunc: func(
			_ context.Context,
			sessionID string,
		) (browserbaseSessionResponse, error) {
			releasedSessionID = sessionID
			return validBrowserbaseSessionResponse(sessionID), nil
		},
		deleteExtensionFunc: func(_ context.Context, extensionID string) error {
			deletedExtensionID = extensionID
			return nil
		},
	}
	client := newBrowserbaseTestSessionClient(t, api)

	_, err := client.createSession(context.Background(), BrowserbaseClientBrowserSource{})
	if err == nil || !strings.Contains(err.Error(), "connectUrl must be an absolute URL") {
		t.Fatalf("createSession() error = %v, want invalid connectUrl", err)
	}
	if releasedSessionID != "session_123" {
		t.Fatalf("released session = %q, want session_123", releasedSessionID)
	}
	if deletedExtensionID != "ext_stagehand" {
		t.Fatalf("deleted extension = %q, want ext_stagehand", deletedExtensionID)
	}
}

func TestBrowserbaseSessionCloseRetriesOnlyFailedSteps(t *testing.T) {
	t.Run("release", func(t *testing.T) {
		releaseErr := errors.New("release failed")
		releaseCalls := 0
		deleteCalls := 0
		api := &fakeBrowserbaseAPI{
			releaseSessionFunc: func(
				_ context.Context,
				sessionID string,
			) (browserbaseSessionResponse, error) {
				releaseCalls++
				if releaseCalls == 1 {
					return browserbaseSessionResponse{}, releaseErr
				}
				return validBrowserbaseSessionResponse(sessionID), nil
			},
			deleteExtensionFunc: func(context.Context, string) error {
				deleteCalls++
				return nil
			},
		}
		client := newBrowserbaseTestSessionClient(t, api)
		browser, err := client.createSession(
			context.Background(),
			BrowserbaseClientBrowserSource{},
		)
		if err != nil {
			t.Fatalf("createSession() error = %v", err)
		}

		if err := browser.close(context.Background()); !errors.Is(err, releaseErr) {
			t.Fatalf("first close() error = %v, want release error", err)
		}
		if err := browser.close(context.Background()); err != nil {
			t.Fatalf("second close() error = %v", err)
		}
		if releaseCalls != 2 || deleteCalls != 1 {
			t.Fatalf(
				"release calls = %d, delete calls = %d; want 2 and 1",
				releaseCalls,
				deleteCalls,
			)
		}
	})

	t.Run("extension deletion", func(t *testing.T) {
		deleteErr := errors.New("extension deletion failed")
		releaseCalls := 0
		deleteCalls := 0
		api := &fakeBrowserbaseAPI{
			releaseSessionFunc: func(
				_ context.Context,
				sessionID string,
			) (browserbaseSessionResponse, error) {
				releaseCalls++
				return validBrowserbaseSessionResponse(sessionID), nil
			},
			deleteExtensionFunc: func(context.Context, string) error {
				deleteCalls++
				if deleteCalls == 1 {
					return deleteErr
				}
				return nil
			},
		}
		client := newBrowserbaseTestSessionClient(t, api)
		browser, err := client.createSession(
			context.Background(),
			BrowserbaseClientBrowserSource{},
		)
		if err != nil {
			t.Fatalf("createSession() error = %v", err)
		}

		if err := browser.close(context.Background()); !errors.Is(err, deleteErr) {
			t.Fatalf("first close() error = %v, want delete error", err)
		}
		if err := browser.close(context.Background()); err != nil {
			t.Fatalf("second close() error = %v", err)
		}
		if releaseCalls != 1 || deleteCalls != 2 {
			t.Fatalf(
				"release calls = %d, delete calls = %d; want 1 and 2",
				releaseCalls,
				deleteCalls,
			)
		}
	})
}

func TestBrowserbaseSessionClientRejectsInvalidUploadResponse(t *testing.T) {
	api := &fakeBrowserbaseAPI{
		uploadExtensionFunc: func(
			context.Context,
			[]byte,
		) (browserbaseExtensionResponse, error) {
			response := validBrowserbaseExtensionResponse("")
			return response, nil
		},
	}
	client := newBrowserbaseTestSessionClient(t, api)

	_, err := client.createSession(context.Background(), BrowserbaseClientBrowserSource{})
	if err == nil || !strings.Contains(err.Error(), "empty extension ID") {
		t.Fatalf("createSession() error = %v, want empty extension ID", err)
	}
}

func TestBrowserbaseSessionClientValidatesBeforeUploadingExtension(t *testing.T) {
	uploads := 0
	api := &fakeBrowserbaseAPI{
		uploadExtensionFunc: func(
			context.Context,
			[]byte,
		) (browserbaseExtensionResponse, error) {
			uploads++
			return validBrowserbaseExtensionResponse("ext_stagehand"), nil
		},
	}
	client := newBrowserbaseTestSessionClient(t, api)

	_, err := client.createSession(context.Background(), BrowserbaseClientBrowserSource{
		Timeout: testPointer(60.5),
	})
	if err == nil || !strings.Contains(err.Error(), "whole number") {
		t.Fatalf("createSession() error = %v, want whole-number timeout error", err)
	}
	if uploads != 0 {
		t.Fatalf("extension uploads = %d, want 0", uploads)
	}
}

func TestBrowserbaseSessionClientStampsUnspoofableAttribution(t *testing.T) {
	var gotUserMetadata map[string]json.RawMessage
	api := &fakeBrowserbaseAPI{
		createSessionFunc: func(
			_ context.Context,
			request browserbaseCreateSessionRequest,
		) (browserbaseCreateSessionResponse, error) {
			gotUserMetadata = request.UserMetadata
			return validBrowserbaseCreateSessionResponse("session_123"), nil
		},
	}
	client := newBrowserbaseTestSessionClient(t, api)

	_, err := client.createSession(context.Background(), BrowserbaseClientBrowserSource{
		UserMetadata: map[string]json.RawMessage{
			"suite":                  json.RawMessage(`"go-browserbase-session"`),
			"stagehand":              json.RawMessage(`"false"`),
			"stagehand_sdk_language": json.RawMessage(`"python"`),
		},
	})
	if err != nil {
		t.Fatalf("createSession() error = %v", err)
	}

	want := map[string]json.RawMessage{
		"suite":                  json.RawMessage(`"go-browserbase-session"`),
		"stagehand":              json.RawMessage(`"true"`),
		"stagehand_sdk_language": json.RawMessage(`"go"`),
	}
	if !reflect.DeepEqual(gotUserMetadata, want) {
		t.Fatalf("userMetadata = %#v, want %#v", gotUserMetadata, want)
	}
}

func newBrowserbaseTestSessionClient(
	t *testing.T,
	api browserbaseAPI,
) *browserbaseSessionClient {
	t.Helper()
	client, err := newBrowserbaseSessionClient("", browserbaseSessionClientOptions{
		api:     api,
		archive: func() []byte { return []byte("test-extension") },
	})
	if err != nil {
		t.Fatalf("newBrowserbaseSessionClient() error = %v", err)
	}
	return client
}

func validBrowserbaseExtensionResponse(extensionID string) browserbaseExtensionResponse {
	return browserbaseExtensionResponse{
		ID:        testPointer(extensionID),
		CreatedAt: testPointer("2026-07-23T10:00:00.000Z"),
		FileName:  testPointer(stagehandExtensionUploadName),
		ProjectID: testPointer("project_123"),
		UpdatedAt: testPointer("2026-07-23T10:00:00.000Z"),
	}
}

func validBrowserbaseSessionResponse(sessionID string) browserbaseSessionResponse {
	fields := validBrowserbaseSessionResponseFields(sessionID)
	return browserbaseSessionResponse{browserbaseSessionResponseFields: fields}
}

func validBrowserbaseCreateSessionResponse(
	sessionID string,
) browserbaseCreateSessionResponse {
	return browserbaseCreateSessionResponse{
		browserbaseSessionResponseFields: validBrowserbaseSessionResponseFields(sessionID),
		ConnectURL: testPointer(
			"wss://connect.browserbase.com/devtools/browser/" + sessionID,
		),
		SeleniumRemoteURL: testPointer(
			"https://connect.browserbase.com/selenium/" + sessionID,
		),
		SigningKey: testPointer("signing_key"),
	}
}

func validBrowserbaseSessionResponseFields(
	sessionID string,
) browserbaseSessionResponseFields {
	return browserbaseSessionResponseFields{
		ID:         testPointer(sessionID),
		CreatedAt:  testPointer("2026-07-23T10:00:00.000Z"),
		ExpiresAt:  testPointer("2026-07-23T10:05:00.000Z"),
		KeepAlive:  testPointer(false),
		ProjectID:  testPointer("project_123"),
		ProxyBytes: testPointer(int64(0)),
		Region:     testPointer(BrowserbaseRegionUSWest2),
		StartedAt:  testPointer("2026-07-23T10:00:01.000Z"),
		Status:     testPointer(browserbaseSessionStatusRunning),
		UpdatedAt:  testPointer("2026-07-23T10:00:01.000Z"),
	}
}
