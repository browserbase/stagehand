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
	uploadExtensionCalls int
	deleteExtensionCalls int
	createSessionCalls   int
	retrieveSessionCalls int
	releaseSessionCalls  int
	uploadExtensionFunc  func(
		context.Context,
		[]byte,
	) (browserbaseExtensionResponse, error)
	deleteExtensionFunc func(context.Context, string) error
	createSessionFunc   func(
		context.Context,
		browserbaseCreateSessionRequest,
	) (browserbaseCreateSessionResponse, error)
	retrieveSessionFunc func(
		context.Context,
		string,
	) (browserbaseRetrieveSessionResponse, error)
	releaseSessionFunc func(context.Context, string) (browserbaseSessionResponse, error)
}

func (api *fakeBrowserbaseAPI) uploadExtension(
	ctx context.Context,
	archive []byte,
) (browserbaseExtensionResponse, error) {
	api.uploadExtensionCalls++
	if api.uploadExtensionFunc != nil {
		return api.uploadExtensionFunc(ctx, archive)
	}
	return validBrowserbaseExtensionResponse("ext_stagehand"), nil
}

func (api *fakeBrowserbaseAPI) deleteExtension(
	ctx context.Context,
	extensionID string,
) error {
	api.deleteExtensionCalls++
	if api.deleteExtensionFunc != nil {
		return api.deleteExtensionFunc(ctx, extensionID)
	}
	return nil
}

func (api *fakeBrowserbaseAPI) createSession(
	ctx context.Context,
	request browserbaseCreateSessionRequest,
) (browserbaseCreateSessionResponse, error) {
	api.createSessionCalls++
	if api.createSessionFunc != nil {
		return api.createSessionFunc(ctx, request)
	}
	return validBrowserbaseCreateSessionResponse("session_123"), nil
}

func (api *fakeBrowserbaseAPI) retrieveSession(
	ctx context.Context,
	sessionID string,
) (browserbaseRetrieveSessionResponse, error) {
	api.retrieveSessionCalls++
	if api.retrieveSessionFunc != nil {
		return api.retrieveSessionFunc(ctx, sessionID)
	}
	return validBrowserbaseRetrieveSessionResponse(sessionID), nil
}

func (api *fakeBrowserbaseAPI) releaseSession(
	ctx context.Context,
	sessionID string,
) (browserbaseSessionResponse, error) {
	api.releaseSessionCalls++
	if api.releaseSessionFunc != nil {
		return api.releaseSessionFunc(ctx, sessionID)
	}
	return validBrowserbaseSessionResponse(sessionID), nil
}

func TestBrowserbaseSessionClientCallerExtensionsAreBorrowed(t *testing.T) {
	createErr := errors.New("session creation failed")
	tests := []struct {
		name           string
		params         BrowserbaseLaunchOptions
		path           string
		wantTopID      *string
		wantSettingsID *string
		wantRelease    int
	}{
		{
			name: "top-level success",
			params: BrowserbaseLaunchOptions{
				ExtensionID: testPointer("ext_top"),
				BrowserSettings: &BrowserbaseBrowserSettings{
					ExtensionID: testPointer("ext_settings"),
				},
			},
			path:           "success",
			wantTopID:      testPointer("ext_top"),
			wantSettingsID: testPointer("ext_settings"),
		},
		{
			name:      "top-level create failure",
			params:    BrowserbaseLaunchOptions{ExtensionID: testPointer("ext_top")},
			path:      "create failure",
			wantTopID: testPointer("ext_top"),
		},
		{
			name:        "top-level invalid session",
			params:      BrowserbaseLaunchOptions{ExtensionID: testPointer("ext_top")},
			path:        "invalid session",
			wantTopID:   testPointer("ext_top"),
			wantRelease: 1,
		},
		{
			name:        "top-level close",
			params:      BrowserbaseLaunchOptions{ExtensionID: testPointer("ext_top")},
			path:        "close",
			wantTopID:   testPointer("ext_top"),
			wantRelease: 1,
		},
		{
			name: "browser settings success",
			params: BrowserbaseLaunchOptions{BrowserSettings: &BrowserbaseBrowserSettings{
				ExtensionID: testPointer("ext_settings"),
			}},
			path:           "success",
			wantSettingsID: testPointer("ext_settings"),
		},
		{
			name: "browser settings create failure",
			params: BrowserbaseLaunchOptions{BrowserSettings: &BrowserbaseBrowserSettings{
				ExtensionID: testPointer("ext_settings"),
			}},
			path:           "create failure",
			wantSettingsID: testPointer("ext_settings"),
		},
		{
			name: "browser settings invalid session",
			params: BrowserbaseLaunchOptions{BrowserSettings: &BrowserbaseBrowserSettings{
				ExtensionID: testPointer("ext_settings"),
			}},
			path:           "invalid session",
			wantSettingsID: testPointer("ext_settings"),
			wantRelease:    1,
		},
		{
			name: "browser settings close",
			params: BrowserbaseLaunchOptions{BrowserSettings: &BrowserbaseBrowserSettings{
				ExtensionID: testPointer("ext_settings"),
			}},
			path:           "close",
			wantSettingsID: testPointer("ext_settings"),
			wantRelease:    1,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var gotRequest browserbaseCreateSessionRequest
			api := &fakeBrowserbaseAPI{
				createSessionFunc: func(
					_ context.Context,
					request browserbaseCreateSessionRequest,
				) (browserbaseCreateSessionResponse, error) {
					gotRequest = request
					if test.path == "create failure" {
						return browserbaseCreateSessionResponse{}, createErr
					}
					response := validBrowserbaseCreateSessionResponse("session_123")
					if test.path == "invalid session" {
						response.ConnectURL = testPointer(" ")
					}
					return response, nil
				},
			}
			client := newBrowserbaseTestSessionClient(t, api)
			browser, err := client.createSession(context.Background(), test.params)
			switch test.path {
			case "success", "close":
				if err != nil {
					t.Fatalf("createSession() error = %v", err)
				}
			case "create failure":
				if err == nil || err.Error() != "failed to create a Browserbase session" {
					t.Fatalf("createSession() error = %v", err)
				}
			case "invalid session":
				if err == nil {
					t.Fatal("createSession() error = nil")
				}
			}
			if test.path == "close" {
				if err := browser.close(context.Background()); err != nil {
					t.Fatalf("close() error = %v", err)
				}
			}
			if api.uploadExtensionCalls != 0 || api.deleteExtensionCalls != 0 {
				t.Fatalf(
					"extension calls = upload %d, delete %d; want zero",
					api.uploadExtensionCalls,
					api.deleteExtensionCalls,
				)
			}
			if api.releaseSessionCalls != test.wantRelease {
				t.Fatalf("release calls = %d, want %d", api.releaseSessionCalls, test.wantRelease)
			}
			if !reflect.DeepEqual(gotRequest.ExtensionID, test.wantTopID) {
				t.Fatalf("request extensionId = %#v, want %#v", gotRequest.ExtensionID, test.wantTopID)
			}
			var gotSettingsID *string
			if gotRequest.BrowserSettings != nil {
				gotSettingsID = gotRequest.BrowserSettings.ExtensionID
			}
			if !reflect.DeepEqual(gotSettingsID, test.wantSettingsID) {
				t.Fatalf("browserSettings extensionId = %#v, want %#v", gotSettingsID, test.wantSettingsID)
			}
		})
	}
}

func TestBrowserbaseSessionClientRejectsBlankCallerExtensionID(t *testing.T) {
	tests := []struct {
		name   string
		params BrowserbaseLaunchOptions
	}{
		{
			name:   "top-level",
			params: BrowserbaseLaunchOptions{ExtensionID: testPointer(" ")},
		},
		{
			name: "browser settings",
			params: BrowserbaseLaunchOptions{BrowserSettings: &BrowserbaseBrowserSettings{
				ExtensionID: testPointer(" "),
			}},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			api := &fakeBrowserbaseAPI{}
			client := newBrowserbaseTestSessionClient(t, api)
			_, err := client.createSession(context.Background(), test.params)
			if err == nil || !strings.Contains(err.Error(), "extensionId cannot be empty") {
				t.Fatalf("createSession() error = %v, want extensionId cannot be empty", err)
			}
			if api.uploadExtensionCalls != 0 || api.createSessionCalls != 0 ||
				api.deleteExtensionCalls != 0 || api.releaseSessionCalls != 0 {
				t.Fatalf(
					"calls = upload %d, create %d, delete %d, release %d; want zero",
					api.uploadExtensionCalls,
					api.createSessionCalls,
					api.deleteExtensionCalls,
					api.releaseSessionCalls,
				)
			}
		})
	}
}

func TestBrowserbaseSessionClientOwnsProvisionedExtension(t *testing.T) {
	api := &fakeBrowserbaseAPI{}
	client := newBrowserbaseTestSessionClient(t, api)
	browser, err := client.createSession(
		context.Background(),
		BrowserbaseLaunchOptions{},
	)
	if err != nil {
		t.Fatalf("createSession() error = %v", err)
	}
	if err := browser.close(context.Background()); err != nil {
		t.Fatalf("close() error = %v", err)
	}
	if api.uploadExtensionCalls != 1 || api.deleteExtensionCalls != 1 ||
		api.releaseSessionCalls != 1 {
		t.Fatalf(
			"calls = upload %d, delete %d, release %d; want 1, 1, 1",
			api.uploadExtensionCalls,
			api.deleteExtensionCalls,
			api.releaseSessionCalls,
		)
	}
}

func TestBrowserbaseSessionClientConnectSession(t *testing.T) {
	region := BrowserbaseRegionEUCentral1
	api := &fakeBrowserbaseAPI{
		retrieveSessionFunc: func(
			_ context.Context,
			sessionID string,
		) (browserbaseRetrieveSessionResponse, error) {
			if sessionID != "session_123" {
				t.Fatalf("retrieve session ID = %q", sessionID)
			}
			return browserbaseRetrieveSessionResponse{
				ID:         testPointer("session_123"),
				ConnectURL: testPointer("wss://connect.browserbase.com/session_123"),
				Region:     &region,
			}, nil
		},
	}
	client := newBrowserbaseTestSessionClient(t, api)
	connection, err := client.connectSession(context.Background(), " session_123 ")
	if err != nil {
		t.Fatalf("connectSession() error = %v", err)
	}
	if connection.sessionID != "session_123" ||
		connection.cdpURL != "wss://connect.browserbase.com/session_123" ||
		connection.region == nil || *connection.region != region || connection.close == nil {
		t.Fatalf("connection = %#v", connection)
	}
	if api.retrieveSessionCalls != 1 || api.releaseSessionCalls != 0 {
		t.Fatalf(
			"calls = retrieve %d, release %d; want 1, 0",
			api.retrieveSessionCalls,
			api.releaseSessionCalls,
		)
	}
	if err := connection.close(context.Background()); err != nil {
		t.Fatalf("connection close error = %v", err)
	}
	if err := connection.close(context.Background()); err != nil {
		t.Fatalf("second connection close error = %v", err)
	}
	if api.releaseSessionCalls != 1 || api.deleteExtensionCalls != 0 {
		t.Fatalf(
			"close calls = release %d, delete extension %d; want 1, 0",
			api.releaseSessionCalls,
			api.deleteExtensionCalls,
		)
	}
}

func TestBrowserbaseSessionClientConnectSessionRejectsUnavailableSession(t *testing.T) {
	api := &fakeBrowserbaseAPI{
		retrieveSessionFunc: func(
			context.Context,
			string,
		) (browserbaseRetrieveSessionResponse, error) {
			return browserbaseRetrieveSessionResponse{
				ID: testPointer("session_123"),
			}, nil
		},
	}
	client := newBrowserbaseTestSessionClient(t, api)
	_, err := client.connectSession(context.Background(), "session_123")
	if err == nil || !strings.Contains(
		err.Error(),
		"Browserbase session is not available for connection",
	) {
		t.Fatalf("connectSession() error = %v", err)
	}
}

func TestBrowserbaseSessionClientConnectSessionSanitizesRetrieveFailure(t *testing.T) {
	upstreamBody := `{"message":"recognizable retrieve failure"}`
	retrieveErr := &BrowserbaseAPIError{
		Method:     "GET",
		Path:       "/v1/sessions/session_123",
		StatusCode: 503,
		Body:       upstreamBody,
	}
	api := &fakeBrowserbaseAPI{
		retrieveSessionFunc: func(
			context.Context,
			string,
		) (browserbaseRetrieveSessionResponse, error) {
			return browserbaseRetrieveSessionResponse{}, retrieveErr
		},
	}
	client := newBrowserbaseTestSessionClient(t, api)
	_, err := client.connectSession(context.Background(), "session_123")
	var apiErr *BrowserbaseAPIError
	if err == nil || err.Error() != "failed to retrieve the Browserbase session" ||
		errors.As(err, &apiErr) ||
		strings.Contains(err.Error(), upstreamBody) ||
		strings.Contains(err.Error(), "recognizable retrieve failure") {
		t.Fatalf("connectSession() error = %v", err)
	}
}

func TestBrowserbaseSessionClientSanitizesCreateFailureAndCleansExtension(t *testing.T) {
	upstreamBody := `{"message":"recognizable create failure"}`
	createErr := &BrowserbaseAPIError{
		Method:     "POST",
		Path:       "/v1/sessions",
		StatusCode: 429,
		Body:       upstreamBody,
	}
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

	_, err := client.createSession(context.Background(), BrowserbaseLaunchOptions{})
	var apiErr *BrowserbaseAPIError
	if err == nil || err.Error() != "failed to create a Browserbase session" ||
		errors.As(err, &apiErr) ||
		strings.Contains(err.Error(), upstreamBody) ||
		strings.Contains(err.Error(), "recognizable create failure") {
		t.Fatalf("createSession() error = %v", err)
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

	_, err := client.createSession(context.Background(), BrowserbaseLaunchOptions{})
	if err == nil || err.Error() != "failed to create a Browserbase session" {
		t.Fatalf("createSession() error = %v", err)
	}
	if releasedSessionID != "session_123" {
		t.Fatalf("released session = %q, want session_123", releasedSessionID)
	}
	if deletedExtensionID != "ext_stagehand" {
		t.Fatalf("deleted extension = %q, want ext_stagehand", deletedExtensionID)
	}
}

func TestBrowserbaseSessionClientCleanupIgnoresCreateContextCancellation(t *testing.T) {
	tests := []struct {
		name        string
		response    browserbaseCreateSessionResponse
		createErr   error
		wantRelease int
	}{
		{
			name:      "create failure",
			createErr: context.Canceled,
		},
		{
			name: "invalid session",
			response: func() browserbaseCreateSessionResponse {
				response := validBrowserbaseCreateSessionResponse("session_123")
				response.ConnectURL = testPointer("relative-connect-url")
				return response
			}(),
			wantRelease: 1,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			api := &fakeBrowserbaseAPI{
				createSessionFunc: func(
					context.Context,
					browserbaseCreateSessionRequest,
				) (browserbaseCreateSessionResponse, error) {
					cancel()
					if test.createErr != nil {
						return test.response, ctx.Err()
					}
					return test.response, nil
				},
				deleteExtensionFunc: func(ctx context.Context, _ string) error {
					if err := ctx.Err(); err != nil {
						t.Fatalf("deleteExtension() context error = %v", err)
					}
					return nil
				},
				releaseSessionFunc: func(
					ctx context.Context,
					sessionID string,
				) (browserbaseSessionResponse, error) {
					if err := ctx.Err(); err != nil {
						t.Fatalf("releaseSession() context error = %v", err)
					}
					return validBrowserbaseSessionResponse(sessionID), nil
				},
			}
			client := newBrowserbaseTestSessionClient(t, api)

			_, err := client.createSession(ctx, BrowserbaseLaunchOptions{})
			if err == nil {
				t.Fatal("createSession() error = nil")
			}
			if api.deleteExtensionCalls != 1 || api.releaseSessionCalls != test.wantRelease {
				t.Fatalf(
					"cleanup calls = delete %d, release %d; want 1, %d",
					api.deleteExtensionCalls,
					api.releaseSessionCalls,
					test.wantRelease,
				)
			}
		})
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
			BrowserbaseLaunchOptions{},
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
			BrowserbaseLaunchOptions{},
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

	_, err := client.createSession(context.Background(), BrowserbaseLaunchOptions{})
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

	_, err := client.createSession(context.Background(), BrowserbaseLaunchOptions{
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

	callerUserMetadata := map[string]json.RawMessage{
		"suite":                  json.RawMessage(`"go-browserbase-session"`),
		"stagehand":              json.RawMessage(`"false"`),
		"stagehand_sdk_language": json.RawMessage(`"python"`),
		"stagehand_sdk_version":  json.RawMessage(`"0.0.0-spoofed"`),
	}
	_, err := client.createSession(context.Background(), BrowserbaseLaunchOptions{
		UserMetadata: callerUserMetadata,
	})
	if err != nil {
		t.Fatalf("createSession() error = %v", err)
	}

	want := map[string]json.RawMessage{
		"suite":                  json.RawMessage(`"go-browserbase-session"`),
		"stagehand":              json.RawMessage(`"true"`),
		"stagehand_sdk_language": json.RawMessage(`"go"`),
		"stagehand_sdk_version":  json.RawMessage(`"` + stagehandSDKVersion + `"`),
	}
	if !reflect.DeepEqual(gotUserMetadata, want) {
		t.Fatalf("userMetadata = %#v, want %#v", gotUserMetadata, want)
	}

	wantCallerUserMetadata := map[string]json.RawMessage{
		"suite":                  json.RawMessage(`"go-browserbase-session"`),
		"stagehand":              json.RawMessage(`"false"`),
		"stagehand_sdk_language": json.RawMessage(`"python"`),
		"stagehand_sdk_version":  json.RawMessage(`"0.0.0-spoofed"`),
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

func validBrowserbaseRetrieveSessionResponse(
	sessionID string,
) browserbaseRetrieveSessionResponse {
	return browserbaseRetrieveSessionResponse{
		ID: testPointer(sessionID),
		ConnectURL: testPointer(
			"wss://connect.browserbase.com/devtools/browser/" + sessionID,
		),
		Region: testPointer(BrowserbaseRegionUSWest2),
	}
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
