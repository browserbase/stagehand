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
	createSessionCalls   int
	retrieveSessionCalls int
	releaseSessionCalls  int
	createSessionFunc    func(
		context.Context,
		browserbaseCreateSessionRequest,
	) (browserbaseCreateSessionResponse, error)
	retrieveSessionFunc func(
		context.Context,
		string,
	) (browserbaseRetrieveSessionResponse, error)
	releaseSessionFunc func(context.Context, string) (browserbaseSessionResponse, error)
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

func TestBrowserbaseSessionClientPassesCallerExtensionIDsThrough(t *testing.T) {
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
			if api.createSessionCalls != 0 || api.releaseSessionCalls != 0 {
				t.Fatalf(
					"calls = create %d, release %d; want zero",
					api.createSessionCalls,
					api.releaseSessionCalls,
				)
			}
		})
	}
}

func TestBrowserbaseSessionClientOptsIntoBuiltInStagehandExtension(t *testing.T) {
	tests := []struct {
		name     string
		settings *BrowserbaseBrowserSettings
		want     []BrowserbaseExtension
	}{
		{
			name:     "no browser settings",
			settings: nil,
			want:     []BrowserbaseExtension{BrowserbaseExtensionStagehand},
		},
		{
			name:     "no extensions",
			settings: &BrowserbaseBrowserSettings{ExtensionID: testPointer("ext_settings")},
			want:     []BrowserbaseExtension{BrowserbaseExtensionStagehand},
		},
		{
			name: "dedupes and preserves caller order",
			settings: &BrowserbaseBrowserSettings{Extensions: []BrowserbaseExtension{
				BrowserbaseExtensionOnepassword,
				BrowserbaseExtensionBrowserEvents,
				BrowserbaseExtensionOnepassword,
			}},
			want: []BrowserbaseExtension{
				BrowserbaseExtensionOnepassword,
				BrowserbaseExtensionBrowserEvents,
				BrowserbaseExtensionStagehand,
			},
		},
		{
			name: "keeps an explicit stagehand position",
			settings: &BrowserbaseBrowserSettings{Extensions: []BrowserbaseExtension{
				BrowserbaseExtensionStagehand,
				BrowserbaseExtensionOnepassword,
				BrowserbaseExtensionStagehand,
			}},
			want: []BrowserbaseExtension{
				BrowserbaseExtensionStagehand,
				BrowserbaseExtensionOnepassword,
			},
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
					return validBrowserbaseCreateSessionResponse("session_123"), nil
				},
			}
			client := newBrowserbaseTestSessionClient(t, api)
			var callerExtensions []BrowserbaseExtension
			if test.settings != nil {
				callerExtensions = append([]BrowserbaseExtension(nil), test.settings.Extensions...)
			}
			params := BrowserbaseLaunchOptions{BrowserSettings: test.settings}

			browser, err := client.createSession(context.Background(), params)
			if err != nil {
				t.Fatalf("createSession() error = %v", err)
			}
			if !browser.residentBrowserConnection {
				t.Fatal("residentBrowserConnection = false, want true")
			}
			if gotRequest.BrowserSettings == nil ||
				!reflect.DeepEqual(gotRequest.BrowserSettings.Extensions, test.want) {
				t.Fatalf("browserSettings = %#v, want extensions %#v", gotRequest.BrowserSettings, test.want)
			}
			if test.settings != nil {
				if params.BrowserSettings != test.settings ||
					!reflect.DeepEqual(test.settings.Extensions, callerExtensions) {
					t.Fatalf("caller browser settings were mutated: %#v", test.settings)
				}
				if gotRequest.BrowserSettings.ExtensionID != test.settings.ExtensionID {
					t.Fatalf(
						"browserSettings extensionId = %#v, want %#v",
						gotRequest.BrowserSettings.ExtensionID,
						test.settings.ExtensionID,
					)
				}
			} else if params.BrowserSettings != nil {
				t.Fatalf("caller params were mutated: %#v", params)
			}
			if err := browser.close(context.Background()); err != nil {
				t.Fatalf("close() error = %v", err)
			}
			if api.createSessionCalls != 1 || api.releaseSessionCalls != 1 {
				t.Fatalf(
					"calls = create %d, release %d; want 1, 1",
					api.createSessionCalls,
					api.releaseSessionCalls,
				)
			}
		})
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
	want := browserbaseSessionConnection{
		sessionID: "session_123",
		cdpURL:    "wss://connect.browserbase.com/session_123",
		region:    &region,
	}
	if !reflect.DeepEqual(connection, want) {
		t.Fatalf("connection = %#v, want %#v", connection, want)
	}
	if api.retrieveSessionCalls != 1 || api.releaseSessionCalls != 0 {
		t.Fatalf(
			"calls = retrieve %d, release %d; want 1, 0",
			api.retrieveSessionCalls,
			api.releaseSessionCalls,
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

func TestBrowserbaseSessionClientSanitizesCreateFailure(t *testing.T) {
	upstreamBody := `{"message":"recognizable create failure"}`
	createErr := &BrowserbaseAPIError{
		Method:     "POST",
		Path:       "/v1/sessions",
		StatusCode: 429,
		Body:       upstreamBody,
	}
	api := &fakeBrowserbaseAPI{
		createSessionFunc: func(
			context.Context,
			browserbaseCreateSessionRequest,
		) (browserbaseCreateSessionResponse, error) {
			return browserbaseCreateSessionResponse{}, createErr
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
	if api.releaseSessionCalls != 0 {
		t.Fatalf("release calls = %d, want 0", api.releaseSessionCalls)
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

	_, err := client.createSession(context.Background(), BrowserbaseLaunchOptions{})
	if err == nil || err.Error() != "failed to create a Browserbase session" {
		t.Fatalf("createSession() error = %v", err)
	}
	if releasedSessionID != "session_123" {
		t.Fatalf("released session = %q, want session_123", releasedSessionID)
	}
	if api.releaseSessionCalls != 1 {
		t.Fatalf("release calls = %d, want 1", api.releaseSessionCalls)
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
			if api.releaseSessionCalls != test.wantRelease {
				t.Fatalf(
					"release calls = %d, want %d",
					api.releaseSessionCalls,
					test.wantRelease,
				)
			}
		})
	}
}

func TestBrowserbaseSessionCloseRetriesFailedRelease(t *testing.T) {
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
	if err := browser.close(context.Background()); err != nil {
		t.Fatalf("third close() error = %v", err)
	}
	if releaseCalls != 2 {
		t.Fatalf("release calls = %d, want 2", releaseCalls)
	}
}

func TestBrowserbaseSessionClientValidatesBeforeCreatingSession(t *testing.T) {
	api := &fakeBrowserbaseAPI{}
	client := newBrowserbaseTestSessionClient(t, api)

	_, err := client.createSession(context.Background(), BrowserbaseLaunchOptions{
		Timeout: testPointer(60.5),
	})
	if err == nil || !strings.Contains(err.Error(), "whole number") {
		t.Fatalf("createSession() error = %v, want whole-number timeout error", err)
	}
	if api.createSessionCalls != 0 {
		t.Fatalf("session creates = %d, want 0", api.createSessionCalls)
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
		api: api,
	})
	if err != nil {
		t.Fatalf("newBrowserbaseSessionClient() error = %v", err)
	}
	return client
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
