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

func TestBrowserbaseSessionClientDoesNotProvisionExtensions(t *testing.T) {
	createErr := errors.New("concurrency limit reached")
	uploads := 0
	deletes := 0
	api := &fakeBrowserbaseAPI{
		uploadExtensionFunc: func(
			context.Context,
			[]byte,
		) (browserbaseExtensionResponse, error) {
			uploads++
			return validBrowserbaseExtensionResponse("ext_stagehand"), nil
		},
		createSessionFunc: func(
			context.Context,
			browserbaseCreateSessionRequest,
		) (browserbaseCreateSessionResponse, error) {
			return browserbaseCreateSessionResponse{}, createErr
		},
		deleteExtensionFunc: func(context.Context, string) error {
			deletes++
			return nil
		},
	}
	client := newBrowserbaseTestSessionClient(t, api)

	_, err := client.createSession(context.Background(), BrowserbaseClientBrowserSource{})
	if !errors.Is(err, createErr) {
		t.Fatalf("createSession() error = %v, want create error", err)
	}
	if uploads != 0 || deletes != 0 {
		t.Fatalf("extension API calls = upload:%d delete:%d, want zero", uploads, deletes)
	}
}

func TestBrowserbaseSessionClientOptsIntoBuiltInStagehandExtension(t *testing.T) {
	var got []BrowserbaseExtension
	api := &fakeBrowserbaseAPI{
		createSessionFunc: func(
			_ context.Context,
			request browserbaseCreateSessionRequest,
		) (browserbaseCreateSessionResponse, error) {
			got = append(got, request.BrowserSettings.Extensions...)
			return validBrowserbaseCreateSessionResponse("session_123"), nil
		},
	}
	client := newBrowserbaseTestSessionClient(t, api)
	original := []BrowserbaseExtension{
		BrowserbaseExtensionOnepassword,
		BrowserbaseExtensionBrowserEvents,
		BrowserbaseExtensionOnepassword,
	}
	_, err := client.createSession(context.Background(), BrowserbaseClientBrowserSource{
		BrowserSettings: &BrowserbaseBrowserSettings{Extensions: original},
	})
	if err != nil {
		t.Fatalf("createSession() error = %v", err)
	}
	want := []BrowserbaseExtension{
		BrowserbaseExtensionOnepassword,
		BrowserbaseExtensionBrowserEvents,
		BrowserbaseExtensionStagehand,
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("extensions = %#v, want %#v", got, want)
	}
	if !reflect.DeepEqual(original, []BrowserbaseExtension{
		BrowserbaseExtensionOnepassword,
		BrowserbaseExtensionBrowserEvents,
		BrowserbaseExtensionOnepassword,
	}) {
		t.Fatalf("caller extensions mutated: %#v", original)
	}
}

func TestBrowserbaseSessionClientCleansInvalidSession(t *testing.T) {
	releasedSessionID := ""
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
	}
	client := newBrowserbaseTestSessionClient(t, api)

	_, err := client.createSession(context.Background(), BrowserbaseClientBrowserSource{})
	if err == nil || !strings.Contains(err.Error(), "connectUrl must be an absolute URL") {
		t.Fatalf("createSession() error = %v, want invalid connectUrl", err)
	}
	if releasedSessionID != "session_123" {
		t.Fatalf("released session = %q, want session_123", releasedSessionID)
	}
}

func TestBrowserbaseSessionCloseRetriesOnlyFailedSteps(t *testing.T) {
	t.Run("release", func(t *testing.T) {
		releaseErr := errors.New("release failed")
		releaseCalls := 0
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
		if releaseCalls != 2 {
			t.Fatalf("release calls = %d, want 2", releaseCalls)
		}
	})
}

func TestBrowserbaseSessionClientValidatesBeforeCreatingSession(t *testing.T) {
	creates := 0
	api := &fakeBrowserbaseAPI{
		createSessionFunc: func(
			context.Context,
			browserbaseCreateSessionRequest,
		) (browserbaseCreateSessionResponse, error) {
			creates++
			return validBrowserbaseCreateSessionResponse("session_123"), nil
		},
	}
	client := newBrowserbaseTestSessionClient(t, api)

	_, err := client.createSession(context.Background(), BrowserbaseClientBrowserSource{
		Timeout: testPointer(60.5),
	})
	if err == nil || !strings.Contains(err.Error(), "whole number") {
		t.Fatalf("createSession() error = %v, want whole-number timeout error", err)
	}
	if creates != 0 {
		t.Fatalf("session creates = %d, want 0", creates)
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

	callerUserMetadata := map[string]json.RawMessage{
		"suite":                  json.RawMessage(`"go-browserbase-session"`),
		"stagehand":              json.RawMessage(`"false"`),
		"stagehand_sdk_language": json.RawMessage(`"python"`),
	}
	_, err := client.createSession(context.Background(), BrowserbaseClientBrowserSource{
		UserMetadata: callerUserMetadata,
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

	wantCallerUserMetadata := map[string]json.RawMessage{
		"suite":                  json.RawMessage(`"go-browserbase-session"`),
		"stagehand":              json.RawMessage(`"false"`),
		"stagehand_sdk_language": json.RawMessage(`"python"`),
	}
	if !reflect.DeepEqual(callerUserMetadata, wantCallerUserMetadata) {
		t.Fatalf(
			"caller userMetadata = %#v, want %#v",
			callerUserMetadata,
			wantCallerUserMetadata,
		)
	}
}

func newBrowserbaseTestSessionClient(
	t *testing.T,
	api browserbaseAPI,
) *browserbaseSessionClient {
	t.Helper()
	client, err := newBrowserbaseSessionClient("", browserbaseSessionClientOptions{
		api: api,
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
