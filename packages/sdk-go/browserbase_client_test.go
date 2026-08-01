package stagehand

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestBrowserbaseHTTPClientUsesTypedEndpointSchemas(t *testing.T) {
	archive := []byte("test-stagehand-extension")
	calls := make([]string, 0, 4)
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(
		writer http.ResponseWriter,
		request *http.Request,
	) {
		calls = append(calls, request.Method+" "+request.URL.EscapedPath())
		if request.Header.Get("X-BB-API-Key") != "bb_test" {
			t.Errorf("X-BB-API-Key = %q", request.Header.Get("X-BB-API-Key"))
		}
		if request.Header.Get("User-Agent") != stagehandSDKClientName+"/"+stagehandSDKVersion {
			t.Errorf("User-Agent = %q", request.Header.Get("User-Agent"))
		}

		switch {
		case request.Method == http.MethodPost && request.URL.Path == "/v1/extensions":
			if err := request.ParseMultipartForm(1 << 20); err != nil {
				t.Errorf("parse extension multipart body: %v", err)
				writer.WriteHeader(http.StatusBadRequest)
				return
			}
			file, header, err := request.FormFile("file")
			if err != nil {
				t.Errorf("read extension multipart file: %v", err)
				writer.WriteHeader(http.StatusBadRequest)
				return
			}
			defer file.Close()
			body, err := io.ReadAll(file)
			if err != nil {
				t.Errorf("read extension body: %v", err)
			}
			if !bytes.Equal(body, archive) {
				t.Errorf("extension body = %q, want %q", body, archive)
			}
			if header.Filename != stagehandExtensionUploadName {
				t.Errorf(
					"extension filename = %q, want %q",
					header.Filename,
					stagehandExtensionUploadName,
				)
			}
			writeBrowserbaseTestJSON(writer, browserbaseTestExtensionResponse("ext_stagehand"))

		case request.Method == http.MethodPost && request.URL.Path == "/v1/sessions":
			var got map[string]any
			if err := json.NewDecoder(request.Body).Decode(&got); err != nil {
				t.Errorf("decode session request: %v", err)
				writer.WriteHeader(http.StatusBadRequest)
				return
			}
			want := browserbaseExpectedSessionRequest()
			if !reflect.DeepEqual(got, want) {
				t.Errorf("session request = %#v, want %#v", got, want)
			}
			response := browserbaseTestCreateSessionResponse("session_123")
			response["futureField"] = "accepted like a Zod object"
			writeBrowserbaseTestJSON(writer, response)

		case request.Method == http.MethodPost &&
			request.URL.Path == "/v1/sessions/session_123":
			var got map[string]any
			if err := json.NewDecoder(request.Body).Decode(&got); err != nil {
				t.Errorf("decode session release request: %v", err)
			}
			want := map[string]any{"status": browserbaseSessionReleaseStatus}
			if !reflect.DeepEqual(got, want) {
				t.Errorf("release request = %#v, want %#v", got, want)
			}
			writeBrowserbaseTestJSON(
				writer,
				browserbaseTestSessionResponse("session_123", "COMPLETED"),
			)

		case request.Method == http.MethodDelete &&
			request.URL.Path == "/v1/extensions/ext_stagehand":
			if request.Header.Get("Content-Type") != "" {
				t.Errorf("extension DELETE Content-Type = %q", request.Header.Get("Content-Type"))
			}
			if request.Header.Get("Accept") != "*/*" {
				t.Errorf("extension DELETE Accept = %q", request.Header.Get("Accept"))
			}
			writer.WriteHeader(http.StatusNoContent)

		default:
			http.Error(writer, "unexpected endpoint", http.StatusNotFound)
		}
	}))
	defer server.Close()

	api, err := newBrowserbaseHTTPClient("bb_test", browserbaseHTTPClientOptions{
		baseURL:    server.URL,
		httpClient: server.Client(),
	})
	if err != nil {
		t.Fatalf("newBrowserbaseHTTPClient() error = %v", err)
	}
	client, err := newBrowserbaseSessionClient("bb_test", browserbaseSessionClientOptions{
		api:     api,
		archive: func() []byte { return bytes.Clone(archive) },
	})
	if err != nil {
		t.Fatalf("newBrowserbaseSessionClient() error = %v", err)
	}

	browser, err := client.createSession(context.Background(), browserbaseTestSessionParams())
	if err != nil {
		t.Fatalf("createSession() error = %v", err)
	}
	if browser.cdpURL !=
		"wss://connect.browserbase.com/devtools/browser/session_123" {
		t.Fatalf("cdpURL = %q", browser.cdpURL)
	}
	if browser.browserbaseSessionID != "session_123" {
		t.Fatalf("browserbaseSessionID = %q", browser.browserbaseSessionID)
	}
	if err := browser.close(context.Background()); err != nil {
		t.Fatalf("close() error = %v", err)
	}
	if err := browser.close(context.Background()); err != nil {
		t.Fatalf("second close() error = %v", err)
	}

	wantCalls := []string{
		"POST /v1/extensions",
		"POST /v1/sessions",
		"POST /v1/sessions/session_123",
		"DELETE /v1/extensions/ext_stagehand",
	}
	if !reflect.DeepEqual(calls, wantCalls) {
		t.Fatalf("calls = %#v, want %#v", calls, wantCalls)
	}
}

func TestBrowserbaseHTTPClientRetriesReplayableRequests(t *testing.T) {
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(
		writer http.ResponseWriter,
		request *http.Request,
	) {
		requests++
		if requests == 1 {
			writer.Header().Set("retry-after-ms", "0")
			http.Error(writer, "rate limited", http.StatusTooManyRequests)
			return
		}
		writeBrowserbaseTestJSON(
			writer,
			browserbaseTestSessionResponse("session_retry", "COMPLETED"),
		)
	}))
	defer server.Close()

	var sleeps []time.Duration
	client, err := newBrowserbaseHTTPClient("bb_test", browserbaseHTTPClientOptions{
		baseURL:    server.URL,
		httpClient: server.Client(),
		sleep: func(_ context.Context, duration time.Duration) error {
			sleeps = append(sleeps, duration)
			return nil
		},
	})
	if err != nil {
		t.Fatalf("newBrowserbaseHTTPClient() error = %v", err)
	}
	response, err := client.releaseSession(context.Background(), "session_retry")
	if err != nil {
		t.Fatalf("releaseSession() error = %v", err)
	}
	if response.ID == nil || *response.ID != "session_retry" {
		t.Fatalf("response ID = %#v", response.ID)
	}
	if requests != 2 {
		t.Fatalf("requests = %d, want 2", requests)
	}
	if !reflect.DeepEqual(sleeps, []time.Duration{0}) {
		t.Fatalf("sleeps = %#v, want [0]", sleeps)
	}
}

func TestBrowserbaseHTTPClientRetrievesSessions(t *testing.T) {
	tests := []struct {
		name       string
		body       string
		statusCode int
		wantURL    string
		wantRegion *BrowserbaseRegion
		wantAPIErr bool
		wantError  string
	}{
		{
			name: "connection and region",
			body: `{
				"id":"session_123",
				"connectUrl":"wss://connect.browserbase.com/devtools/browser/session_123",
				"region":"us-west-2"
			}`,
			wantURL:    "wss://connect.browserbase.com/devtools/browser/session_123",
			wantRegion: testPointer(BrowserbaseRegionUSWest2),
		},
		{
			name: "optional fields omitted",
			body: `{"id":"session_123"}`,
		},
		{
			name:       "API error",
			body:       `{"message":"session unavailable"}`,
			statusCode: http.StatusNotFound,
			wantAPIErr: true,
		},
		{
			name:      "invalid region",
			body:      `{"id":"session_123","region":"moon-1"}`,
			wantError: "invalid region",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(
				writer http.ResponseWriter,
				request *http.Request,
			) {
				if request.Method != http.MethodGet || request.URL.Path != "/v1/sessions/session_123" {
					t.Errorf("request = %s %s", request.Method, request.URL.Path)
				}
				if test.wantAPIErr {
					writer.Header().Set("x-should-retry", "false")
				}
				if test.statusCode != 0 {
					writer.WriteHeader(test.statusCode)
				}
				_, _ = writer.Write([]byte(test.body))
			}))
			defer server.Close()

			client, err := newBrowserbaseHTTPClient("bb_test", browserbaseHTTPClientOptions{
				baseURL:    server.URL,
				httpClient: server.Client(),
			})
			if err != nil {
				t.Fatalf("newBrowserbaseHTTPClient() error = %v", err)
			}
			response, err := client.retrieveSession(context.Background(), "session_123")
			if test.wantAPIErr {
				var apiErr *BrowserbaseAPIError
				if !errors.As(err, &apiErr) || apiErr.StatusCode != test.statusCode {
					t.Fatalf("retrieveSession() error = %v, want BrowserbaseAPIError", err)
				}
				return
			}
			if test.wantError != "" {
				if err == nil || !strings.Contains(err.Error(), test.wantError) {
					t.Fatalf("retrieveSession() error = %v, want containing %q", err, test.wantError)
				}
				return
			}
			if err != nil {
				t.Fatalf("retrieveSession() error = %v", err)
			}
			if response.ID == nil || *response.ID != "session_123" {
				t.Fatalf("response ID = %#v", response.ID)
			}
			gotURL := ""
			if response.ConnectURL != nil {
				gotURL = *response.ConnectURL
			}
			if gotURL != test.wantURL || !reflect.DeepEqual(response.Region, test.wantRegion) {
				t.Fatalf("response = %#v", response)
			}
		})
	}
}

func TestBrowserbaseRetrieveSessionResponseValidatesOptionalConnectURL(t *testing.T) {
	tests := []struct {
		name       string
		connectURL *string
		wantError  string
	}{
		{
			name: "absent",
		},
		{
			name:       "secure websocket",
			connectURL: testPointer("wss://connect.browserbase.com/session_123"),
		},
		{
			name:       "HTTP scheme",
			connectURL: testPointer("http://connect.browserbase.com/session_123"),
			wantError:  "connectUrl must use one of these schemes: ws, wss",
		},
		{
			name:       "relative",
			connectURL: testPointer("connect/session_123"),
			wantError:  "connectUrl must be an absolute URL",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			response := browserbaseRetrieveSessionResponse{
				ID:         testPointer("session_123"),
				ConnectURL: test.connectURL,
			}
			err := response.validate()
			if test.wantError == "" {
				if err != nil {
					t.Fatalf("validate() error = %v", err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), test.wantError) {
				t.Fatalf("validate() error = %v, want containing %q", err, test.wantError)
			}
		})
	}
}

func TestBrowserbaseHTTPClientDoesNotReplayResourceCreation(t *testing.T) {
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(
		writer http.ResponseWriter,
		request *http.Request,
	) {
		requests++
		http.Error(writer, "temporarily unavailable", http.StatusServiceUnavailable)
	}))
	defer server.Close()

	var sleeps []time.Duration
	client, err := newBrowserbaseHTTPClient("bb_test", browserbaseHTTPClientOptions{
		baseURL:    server.URL,
		httpClient: server.Client(),
		sleep: func(_ context.Context, duration time.Duration) error {
			sleeps = append(sleeps, duration)
			return nil
		},
	})
	if err != nil {
		t.Fatalf("newBrowserbaseHTTPClient() error = %v", err)
	}
	_, err = client.createSession(context.Background(), browserbaseCreateSessionRequest{})
	var apiErr *BrowserbaseAPIError
	if !errors.As(err, &apiErr) || apiErr.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("createSession() error = %v, want 503 BrowserbaseAPIError", err)
	}
	if requests != 1 {
		t.Fatalf("requests = %d, want 1", requests)
	}
	if len(sleeps) != 0 {
		t.Fatalf("retry sleeps = %#v, want none", sleeps)
	}
}

func TestBrowserbaseHTTPClientDoesNotReplayCreationAfterLostResponse(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(
		writer http.ResponseWriter,
		request *http.Request,
	) {
		requests.Add(1)
		hijacker, ok := writer.(http.Hijacker)
		if !ok {
			t.Error("response writer does not support hijacking")
			return
		}
		connection, _, err := hijacker.Hijack()
		if err != nil {
			t.Errorf("hijack response: %v", err)
			return
		}
		_ = connection.Close()
	}))
	defer server.Close()

	client, err := newBrowserbaseHTTPClient("bb_test", browserbaseHTTPClientOptions{
		baseURL:    server.URL,
		httpClient: server.Client(),
	})
	if err != nil {
		t.Fatalf("newBrowserbaseHTTPClient() error = %v", err)
	}
	if _, err := client.createSession(
		context.Background(),
		browserbaseCreateSessionRequest{},
	); err == nil || !strings.Contains(err.Error(), "send Browserbase request") {
		t.Fatalf("createSession() error = %v, want transport error", err)
	}
	if requests.Load() != 1 {
		t.Fatalf("requests = %d, want 1", requests.Load())
	}
}

func TestBrowserbaseRetryDelayCapsServerValues(t *testing.T) {
	tests := []struct {
		name    string
		headers http.Header
		want    time.Duration
	}{
		{
			name:    "milliseconds overflow",
			headers: http.Header{"Retry-After-Ms": []string{"1e100"}},
			want:    maxBrowserbaseRetryDelay,
		},
		{
			name:    "seconds overflow",
			headers: http.Header{"Retry-After": []string{"1e100"}},
			want:    maxBrowserbaseRetryDelay,
		},
		{
			name: "non-finite milliseconds use seconds",
			headers: http.Header{
				"Retry-After-Ms": []string{"+Inf"},
				"Retry-After":    []string{"2"},
			},
			want: 2 * time.Second,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := browserbaseRetryDelay(test.headers, 0); got != test.want {
				t.Fatalf("browserbaseRetryDelay() = %s, want %s", got, test.want)
			}
		})
	}
}

func TestBrowserbaseHTTPClientReturnsTypedAPIErrors(t *testing.T) {
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(
		writer http.ResponseWriter,
		request *http.Request,
	) {
		requests++
		writer.Header().Set("x-request-id", "request_123")
		writer.Header().Set("x-should-retry", "false")
		writer.WriteHeader(http.StatusInternalServerError)
		_, _ = writer.Write([]byte(`{"message":"Browserbase unavailable"}`))
	}))
	defer server.Close()

	client, err := newBrowserbaseHTTPClient("bb_test", browserbaseHTTPClientOptions{
		baseURL:    server.URL,
		httpClient: server.Client(),
	})
	if err != nil {
		t.Fatalf("newBrowserbaseHTTPClient() error = %v", err)
	}
	_, err = client.createSession(context.Background(), browserbaseCreateSessionRequest{})
	var apiErr *BrowserbaseAPIError
	if !errors.As(err, &apiErr) {
		t.Fatalf("createSession() error = %v, want BrowserbaseAPIError", err)
	}
	if apiErr.StatusCode != http.StatusInternalServerError ||
		apiErr.RequestID != "request_123" ||
		!strings.Contains(apiErr.Error(), "Browserbase unavailable") {
		t.Fatalf("BrowserbaseAPIError = %#v (%v)", apiErr, apiErr)
	}
	if requests != 1 {
		t.Fatalf("requests = %d, want 1", requests)
	}
}

func TestBrowserbaseHTTPClientRejectsInvalidResponses(t *testing.T) {
	tests := []struct {
		name string
		body string
		want string
	}{
		{
			name: "malformed JSON",
			body: `{"id":`,
			want: "decode Browserbase",
		},
		{
			name: "missing required field",
			body: `{"id":"session_123"}`,
			want: "required field",
		},
		{
			name: "wrong field type",
			body: `{"id":123}`,
			want: "cannot unmarshal",
		},
		{
			name: "multiple JSON values",
			body: `{} {}`,
			want: "multiple JSON values",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(
				writer http.ResponseWriter,
				request *http.Request,
			) {
				writer.Header().Set("Content-Type", "application/json")
				_, _ = writer.Write([]byte(test.body))
			}))
			defer server.Close()
			client, err := newBrowserbaseHTTPClient("bb_test", browserbaseHTTPClientOptions{
				baseURL:    server.URL,
				httpClient: server.Client(),
			})
			if err != nil {
				t.Fatalf("newBrowserbaseHTTPClient() error = %v", err)
			}
			_, err = client.createSession(
				context.Background(),
				browserbaseCreateSessionRequest{},
			)
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("createSession() error = %v, want containing %q", err, test.want)
			}
		})
	}
}

func TestBrowserbaseHTTPClientValidatesBeforeSending(t *testing.T) {
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(
		writer http.ResponseWriter,
		request *http.Request,
	) {
		requests++
		writer.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()
	client, err := newBrowserbaseHTTPClient("bb_test", browserbaseHTTPClientOptions{
		baseURL:    server.URL,
		httpClient: server.Client(),
	})
	if err != nil {
		t.Fatalf("newBrowserbaseHTTPClient() error = %v", err)
	}

	invalidRegion := BrowserbaseRegion("moon-1")
	_, err = client.createSession(context.Background(), browserbaseCreateSessionRequest{
		Region: &invalidRegion,
	})
	if err == nil || !strings.Contains(err.Error(), "invalid region") {
		t.Fatalf("createSession() error = %v, want invalid region", err)
	}
	if requests != 0 {
		t.Fatalf("requests = %d, want 0", requests)
	}

	_, err = client.createSession(context.Background(), browserbaseCreateSessionRequest{
		Timeout: testPointer(int64(59)),
	})
	if err == nil || !strings.Contains(err.Error(), "between 60 and 21600") {
		t.Fatalf("createSession() error = %v, want invalid timeout", err)
	}
	if requests != 0 {
		t.Fatalf("requests = %d, want 0", requests)
	}
}

func TestNewBrowserbaseHTTPClientValidatesConfiguration(t *testing.T) {
	if _, err := newBrowserbaseHTTPClient("", browserbaseHTTPClientOptions{}); err == nil {
		t.Fatal("empty API key error = nil")
	}
	if _, err := newBrowserbaseHTTPClient("bb_test", browserbaseHTTPClientOptions{
		baseURL: "file:///tmp/browserbase",
	}); err == nil {
		t.Fatal("invalid base URL error = nil")
	}
	if _, err := newBrowserbaseHTTPClient("bb_test", browserbaseHTTPClientOptions{
		maxRetries: testPointer(-1),
	}); err == nil {
		t.Fatal("negative retries error = nil")
	}
}

func browserbaseTestSessionParams() BrowserbaseLaunchOptions {
	keepAlive := true
	advancedStealth := true
	blockAds := false
	persist := true
	logSession := false
	recordSession := true
	solveCaptchas := true
	verified := false
	width := 1280.0
	height := 800.0
	httpVersion := BrowserbaseFingerprintHTTPVersionA2
	minWidth := 1024.0
	city := "Zurich"
	username := "proxy-user"
	password := "proxy-password"
	domainPattern := "*.example.com"
	return BrowserbaseLaunchOptions{
		BrowserSettings: &BrowserbaseBrowserSettings{
			AdvancedStealth: &advancedStealth,
			BlockAds:        &blockAds,
			Context: &BrowserbaseContext{
				ID:      "context_123",
				Persist: &persist,
			},
			LogSession:    &logSession,
			OS:            testPointer(BrowserbaseBrowserSettingsOSMac),
			RecordSession: &recordSession,
			SolveCaptchas: &solveCaptchas,
			Verified:      &verified,
			Viewport:      &BrowserbaseViewport{Width: &width, Height: &height},
			Fingerprint: &BrowserbaseFingerprint{
				Browsers:    []BrowserbaseFingerprintBrowsersElem{BrowserbaseFingerprintBrowsersElemChrome},
				Devices:     []BrowserbaseFingerprintDevicesElem{BrowserbaseFingerprintDevicesElemDesktop},
				HTTPVersion: &httpVersion,
				Locales:     []string{"de-CH", "en-US"},
				OperatingSystems: []BrowserbaseFingerprintOperatingSystemsElem{
					BrowserbaseFingerprintOperatingSystemsElemMacos,
				},
				Screen: &BrowserbaseFingerprintScreen{MinWidth: &minWidth},
			},
		},
		KeepAlive: &keepAlive,
		Proxies: testPointer(BrowserbaseProxyList(
			BrowserbaseProxy(BrowserbaseProxyConfig{
				DomainPattern: &domainPattern,
				Geolocation: &BrowserbaseProxyGeolocation{
					Country: "CH",
					City:    &city,
				},
			}),
			ExternalProxy(ExternalProxyConfig{
				Server:   "http://proxy.example:8080",
				Username: &username,
				Password: &password,
			}),
		)),
		Region:  testPointer(BrowserbaseRegionEUCentral1),
		Timeout: testPointer(300.0),
		UserMetadata: map[string]json.RawMessage{
			"suite":                  json.RawMessage(`"go-browserbase-client"`),
			"attempt":                json.RawMessage(`3`),
			"stagehand":              json.RawMessage(`"false"`),
			"stagehand_sdk_language": json.RawMessage(`"python"`),
		},
	}
}

func browserbaseExpectedSessionRequest() map[string]any {
	return map[string]any{
		"browserSettings": map[string]any{
			"advancedStealth": true,
			"blockAds":        false,
			"context": map[string]any{
				"id":      "context_123",
				"persist": true,
			},
			"logSession":    false,
			"os":            "mac",
			"recordSession": true,
			"solveCaptchas": true,
			"verified":      false,
			"viewport": map[string]any{
				"width":  1280.0,
				"height": 800.0,
			},
			"fingerprint": map[string]any{
				"browsers":         []any{"chrome"},
				"devices":          []any{"desktop"},
				"httpVersion":      "2",
				"locales":          []any{"de-CH", "en-US"},
				"operatingSystems": []any{"macos"},
				"screen":           map[string]any{"minWidth": 1024.0},
			},
		},
		"extensionId": "ext_stagehand",
		"keepAlive":   true,
		"proxies": []any{
			map[string]any{
				"type":          "browserbase",
				"domainPattern": "*.example.com",
				"geolocation": map[string]any{
					"country": "CH",
					"city":    "Zurich",
				},
			},
			map[string]any{
				"type":     "external",
				"server":   "http://proxy.example:8080",
				"username": "proxy-user",
				"password": "proxy-password",
			},
		},
		"region":  "eu-central-1",
		"timeout": 300.0,
		"userMetadata": map[string]any{
			"suite":                  "go-browserbase-client",
			"attempt":                3.0,
			"stagehand":              "true",
			"stagehand_sdk_language": "go",
		},
	}
}

func browserbaseTestExtensionResponse(extensionID string) map[string]any {
	return map[string]any{
		"id":        extensionID,
		"createdAt": "2026-07-23T10:00:00.000Z",
		"fileName":  stagehandExtensionUploadName,
		"projectId": "project_123",
		"updatedAt": "2026-07-23T10:00:00.000Z",
	}
}

func browserbaseTestSessionResponse(sessionID string, status string) map[string]any {
	return map[string]any{
		"id":         sessionID,
		"createdAt":  "2026-07-23T10:00:00.000Z",
		"expiresAt":  "2026-07-23T10:05:00.000Z",
		"keepAlive":  true,
		"projectId":  "project_123",
		"proxyBytes": 0,
		"region":     "eu-central-1",
		"startedAt":  "2026-07-23T10:00:01.000Z",
		"status":     status,
		"updatedAt":  "2026-07-23T10:00:01.000Z",
		"userMetadata": map[string]any{
			"suite": "go-browserbase-client",
		},
	}
}

func browserbaseTestCreateSessionResponse(sessionID string) map[string]any {
	response := browserbaseTestSessionResponse(sessionID, "RUNNING")
	response["connectUrl"] =
		"wss://connect.browserbase.com/devtools/browser/" + sessionID
	response["seleniumRemoteUrl"] = "https://connect.browserbase.com/selenium/" + sessionID
	response["signingKey"] = "signing_key"
	return response
}

func writeBrowserbaseTestJSON(writer http.ResponseWriter, value any) {
	writer.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(writer).Encode(value); err != nil {
		panic(err)
	}
}

func testPointer[Value any](value Value) *Value {
	return &value
}
