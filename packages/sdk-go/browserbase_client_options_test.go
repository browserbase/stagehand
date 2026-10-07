package stagehand

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

type countingRoundTripper struct {
	requests atomic.Int32
}

func (transport *countingRoundTripper) RoundTrip(request *http.Request) (*http.Response, error) {
	transport.requests.Add(1)
	return http.DefaultTransport.RoundTrip(request)
}

func newBrowserbaseTestClientFromOptions(
	t *testing.T,
	baseURL string,
	clientOptions *BrowserbaseClientOptions,
) *browserbaseHTTPClient {
	t.Helper()
	client, err := newBrowserbaseHTTPClient(
		"bb_test",
		browserbaseHTTPClientOptionsFor(baseURL, clientOptions),
	)
	if err != nil {
		t.Fatalf("newBrowserbaseHTTPClient() error = %v", err)
	}
	return client
}

func TestBrowserbaseClientOptionsReachHTTPClient(t *testing.T) {
	httpClient := &http.Client{}
	headers := map[string]string{"X-Request-Source": "my-app"}
	query := map[string]string{"team": "qa"}
	client := newBrowserbaseTestClientFromOptions(t, "https://api.dev.browserbase.com", &BrowserbaseClientOptions{
		Timeout:        5 * time.Second,
		MaxRetries:     testPointer(0),
		DefaultHeaders: headers,
		DefaultQuery:   query,
		HTTPClient:     httpClient,
	})
	if client.baseURL != "https://api.dev.browserbase.com" ||
		client.timeout != 5*time.Second ||
		client.maxRetries != 0 ||
		client.httpClient != httpClient ||
		!reflect.DeepEqual(client.defaultHeaders, headers) ||
		!reflect.DeepEqual(client.defaultQuery, query) {
		t.Fatalf("HTTP client = %#v", client)
	}
	headers["X-Request-Source"] = "mutated"
	query["team"] = "mutated"
	if client.defaultHeaders["X-Request-Source"] != "my-app" || client.defaultQuery["team"] != "qa" {
		t.Fatalf("HTTP client aliases caller maps: %#v %#v", client.defaultHeaders, client.defaultQuery)
	}

	defaults := newBrowserbaseTestClientFromOptions(t, "", nil)
	if defaults.timeout != defaultBrowserbaseHTTPTimeout ||
		defaults.maxRetries != defaultBrowserbaseMaxRetries ||
		defaults.httpClient == nil ||
		defaults.defaultHeaders != nil ||
		defaults.defaultQuery != nil {
		t.Fatalf("default HTTP client = %#v", defaults)
	}
}

func TestBrowserbaseClientOptionsAddDefaultHeadersAndQuery(t *testing.T) {
	stagehandAgent := stagehandSDKClientName + "/" + stagehandSDKVersion
	tests := []struct {
		name        string
		headers     map[string]string
		call        func(*browserbaseHTTPClient) error
		wantMethod  string
		wantHeaders map[string]string
	}{
		{
			name:    "adds defaults alongside Stagehand headers",
			headers: map[string]string{"X-Request-Source": "my-app"},
			call: func(client *browserbaseHTTPClient) error {
				_, err := client.retrieveSession(context.Background(), "session_123")
				return err
			},
			wantMethod: http.MethodGet,
			wantHeaders: map[string]string{
				"X-Request-Source": "my-app",
				"X-BB-API-Key":     "bb_test",
				"User-Agent":       stagehandAgent,
				"Accept":           "application/json",
			},
		},
		{
			name: "defaults override Stagehand headers",
			headers: map[string]string{
				"X-Request-Source": "my-app",
				"x-bb-api-key":     "caller-key",
				"User-Agent":       "caller-agent",
				"Accept":           "text/plain",
				"Content-Type":     "text/plain",
			},
			call: func(client *browserbaseHTTPClient) error {
				_, err := client.releaseSession(context.Background(), "session_123")
				return err
			},
			wantMethod: http.MethodPost,
			wantHeaders: map[string]string{
				"X-Request-Source": "my-app",
				"X-BB-API-Key":     "caller-key",
				"User-Agent":       "caller-agent",
				"Accept":           "text/plain",
				"Content-Type":     "text/plain",
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var requests atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(
				writer http.ResponseWriter,
				request *http.Request,
			) {
				requests.Add(1)
				if request.Method != test.wantMethod {
					t.Errorf("method = %s, want %s", request.Method, test.wantMethod)
				}
				for name, want := range test.wantHeaders {
					if got := request.Header.Get(name); got != want {
						t.Errorf("header %s = %q, want %q", name, got, want)
					}
				}
				if got := request.URL.Query(); !reflect.DeepEqual(got, url.Values{
					"team":  {"qa"},
					"trace": {"a b&c"},
				}) {
					t.Errorf("query = %#v", got)
				}
				writeBrowserbaseTestJSON(writer, browserbaseTestSessionResponse("session_123", "COMPLETED"))
			}))
			defer server.Close()

			client := newBrowserbaseTestClientFromOptions(t, server.URL, &BrowserbaseClientOptions{
				DefaultHeaders: test.headers,
				DefaultQuery:   map[string]string{"team": "qa", "trace": "a b&c"},
				HTTPClient:     server.Client(),
			})
			if err := test.call(client); err != nil {
				t.Fatalf("request error = %v", err)
			}
			if requests.Load() != 1 {
				t.Fatalf("requests = %d, want 1", requests.Load())
			}
		})
	}
}

func TestBrowserbaseClientOptionsMaxRetries(t *testing.T) {
	tests := []struct {
		name         string
		maxRetries   *int
		wantRequests int32
	}{
		{name: "zero disables retries", maxRetries: testPointer(0), wantRequests: 1},
		{name: "one retry", maxRetries: testPointer(1), wantRequests: 2},
		{name: "nil keeps default", wantRequests: defaultBrowserbaseMaxRetries + 1},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var requests atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(
				writer http.ResponseWriter,
				request *http.Request,
			) {
				requests.Add(1)
				writer.Header().Set("retry-after-ms", "0")
				http.Error(writer, "temporarily unavailable", http.StatusServiceUnavailable)
			}))
			defer server.Close()

			client := newBrowserbaseTestClientFromOptions(t, server.URL, &BrowserbaseClientOptions{
				MaxRetries: test.maxRetries,
				HTTPClient: server.Client(),
			})
			_, err := client.retrieveSession(context.Background(), "session_123")
			var apiErr *BrowserbaseAPIError
			if !errors.As(err, &apiErr) || apiErr.StatusCode != http.StatusServiceUnavailable {
				t.Fatalf("retrieveSession() error = %v, want 503 BrowserbaseAPIError", err)
			}
			if requests.Load() != test.wantRequests {
				t.Fatalf("requests = %d, want %d", requests.Load(), test.wantRequests)
			}
		})
	}
}

func TestBrowserbaseClientOptionsTimeoutBoundsEachAttempt(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(
		writer http.ResponseWriter,
		request *http.Request,
	) {
		if requests.Add(1) == 1 {
			// Hang the first attempt until the client gives up on it. The fallback
			// keeps a missing attempt deadline a test failure rather than a hang.
			select {
			case <-request.Context().Done():
			case <-time.After(5 * time.Second):
			}
			return
		}
		writeBrowserbaseTestJSON(writer, browserbaseTestSessionResponse("session_123", "COMPLETED"))
	}))
	defer server.Close()

	httpClient := server.Client()
	client := newBrowserbaseTestClientFromOptions(t, server.URL, &BrowserbaseClientOptions{
		Timeout:    50 * time.Millisecond,
		MaxRetries: testPointer(0),
		HTTPClient: httpClient,
	})
	started := time.Now()
	_, err := client.retrieveSession(context.Background(), "session_123")
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("retrieveSession() error = %v, want context.DeadlineExceeded", err)
	}
	if elapsed := time.Since(started); elapsed > 2*time.Second {
		t.Fatalf("timed-out attempt took %s", elapsed)
	}
	if httpClient.Timeout != 0 {
		t.Fatalf("caller HTTP client Timeout = %s, want unchanged 0", httpClient.Timeout)
	}

	// The timeout is per attempt: a retry after a timed-out attempt gets a fresh deadline.
	requests.Store(0)
	retryingClient := newBrowserbaseTestClientFromOptions(t, server.URL, &BrowserbaseClientOptions{
		Timeout:    50 * time.Millisecond,
		MaxRetries: testPointer(1),
		HTTPClient: httpClient,
	})
	retryingClient.sleep = func(context.Context, time.Duration) error { return nil }
	if _, err := retryingClient.retrieveSession(context.Background(), "session_123"); err != nil {
		t.Fatalf("retrieveSession() after timed-out attempt error = %v", err)
	}
	if requests.Load() != 2 {
		t.Fatalf("requests = %d, want 2", requests.Load())
	}
}

func TestBrowserbaseClientOptionsTimeoutCoversResponseBody(t *testing.T) {
	tests := []struct {
		name      string
		bodyDelay time.Duration
		timeout   time.Duration
		wantErr   error
	}{
		{name: "slow body within timeout", bodyDelay: 100 * time.Millisecond, timeout: 5 * time.Second},
		{
			name:      "stalled body past timeout",
			bodyDelay: 5 * time.Second,
			timeout:   50 * time.Millisecond,
			wantErr:   context.DeadlineExceeded,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(
				writer http.ResponseWriter,
				request *http.Request,
			) {
				// Send the headers first, then delay the body.
				writer.Header().Set("Content-Type", "application/json")
				writer.WriteHeader(http.StatusOK)
				writer.(http.Flusher).Flush()
				select {
				case <-request.Context().Done():
					return
				case <-time.After(test.bodyDelay):
				}
				_ = json.NewEncoder(writer).Encode(
					browserbaseTestSessionResponse("session_123", "COMPLETED"),
				)
			}))
			defer server.Close()

			client := newBrowserbaseTestClientFromOptions(t, server.URL, &BrowserbaseClientOptions{
				Timeout:    test.timeout,
				MaxRetries: testPointer(0),
				HTTPClient: server.Client(),
			})
			started := time.Now()
			_, err := client.retrieveSession(context.Background(), "session_123")
			if test.wantErr == nil {
				if err != nil {
					t.Fatalf("retrieveSession() error = %v", err)
				}
				return
			}
			if !errors.Is(err, test.wantErr) {
				t.Fatalf("retrieveSession() error = %v, want %v", err, test.wantErr)
			}
			if elapsed := time.Since(started); elapsed > 2*time.Second {
				t.Fatalf("stalled body took %s, want it bounded by the attempt timeout", elapsed)
			}
		})
	}
}

func TestBrowserbaseClientOptionsUseCallerHTTPClientWithoutMutation(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(
		writer http.ResponseWriter,
		request *http.Request,
	) {
		writeBrowserbaseTestJSON(writer, browserbaseTestSessionResponse("session_123", "COMPLETED"))
	}))
	defer server.Close()

	transport := &countingRoundTripper{}
	httpClient := &http.Client{Transport: transport}
	before := *httpClient
	client := newBrowserbaseTestClientFromOptions(t, server.URL, &BrowserbaseClientOptions{
		Timeout:    time.Second,
		HTTPClient: httpClient,
	})
	if _, err := client.retrieveSession(context.Background(), "session_123"); err != nil {
		t.Fatalf("retrieveSession() error = %v", err)
	}
	if transport.requests.Load() != 1 {
		t.Fatalf("caller transport requests = %d, want 1", transport.requests.Load())
	}
	if !reflect.DeepEqual(*httpClient, before) {
		t.Fatalf("caller HTTP client mutated: %#v, want %#v", *httpClient, before)
	}
}

func TestBrowserbaseClientOptionsRejectInvalidValuesBeforeRequests(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(
		writer http.ResponseWriter,
		request *http.Request,
	) {
		requests.Add(1)
		writer.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()

	tests := []struct {
		name    string
		options BrowserbaseClientOptions
		want    string
	}{
		{name: "negative timeout", options: BrowserbaseClientOptions{Timeout: -time.Second}, want: "timeout cannot be negative"},
		{name: "negative retries", options: BrowserbaseClientOptions{MaxRetries: testPointer(-1)}, want: "max retries cannot be negative"},
		{
			name:    "header value with newline",
			options: BrowserbaseClientOptions{DefaultHeaders: map[string]string{"X-Bad": "a\nb"}},
			want:    `invalid Browserbase default header "X-Bad" value`,
		},
		{
			name:    "empty header name",
			options: BrowserbaseClientOptions{DefaultHeaders: map[string]string{"": "value"}},
			want:    `invalid Browserbase default header name ""`,
		},
		{
			name:    "header name with space",
			options: BrowserbaseClientOptions{DefaultHeaders: map[string]string{"X Bad": "value"}},
			want:    `invalid Browserbase default header name "X Bad"`,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, launchErr := LaunchBrowserbase(context.Background(), BrowserbaseLaunchOptions{
				APIKey: "bb_test", BaseURL: server.URL, ClientOptions: &test.options,
			})
			_, connectErr := ConnectBrowserbase(context.Background(), BrowserbaseConnectOptions{
				APIKey: "bb_test", BaseURL: server.URL, ClientOptions: &test.options, SessionID: "session_123",
			})
			for name, err := range map[string]error{"LaunchBrowserbase": launchErr, "ConnectBrowserbase": connectErr} {
				if err == nil || !strings.Contains(err.Error(), test.want) {
					t.Fatalf("%s() error = %v, want containing %q", name, err, test.want)
				}
			}
			if requests.Load() != 0 {
				t.Fatalf("requests = %d, want 0", requests.Load())
			}
		})
	}
}

func TestBrowserbaseFactoriesSendClientOptionsOverHTTP(t *testing.T) {
	var sessionCreateBody map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(
		writer http.ResponseWriter,
		request *http.Request,
	) {
		if request.Header.Get("X-Request-Source") != "my-app" || request.URL.Query().Get("team") != "qa" {
			t.Errorf("%s %s headers = %#v, query = %q", request.Method, request.URL.Path, request.Header, request.URL.RawQuery)
		}
		switch {
		case request.Method == http.MethodPost && request.URL.Path == "/v1/sessions":
			if err := json.NewDecoder(request.Body).Decode(&sessionCreateBody); err != nil {
				t.Errorf("decode session request: %v", err)
			}
			writeBrowserbaseTestJSON(writer, browserbaseTestCreateSessionResponse("session_123"))
		case request.Method == http.MethodGet && request.URL.Path == "/v1/sessions/session_123":
			writeBrowserbaseTestJSON(writer, browserbaseTestCreateSessionResponse("session_123"))
		case request.Method == http.MethodPost && request.URL.Path == "/v1/sessions/session_123":
			writeBrowserbaseTestJSON(writer, browserbaseTestSessionResponse("session_123", "COMPLETED"))
		default:
			http.Error(writer, "unexpected endpoint", http.StatusNotFound)
		}
	}))
	defer server.Close()

	transport := &countingRoundTripper{}
	clientOptions := &BrowserbaseClientOptions{
		Timeout:        5 * time.Second,
		MaxRetries:     testPointer(0),
		DefaultHeaders: map[string]string{"X-Request-Source": "my-app"},
		DefaultQuery:   map[string]string{"team": "qa"},
		HTTPClient:     &http.Client{Transport: transport},
	}
	dependencies := browserFactoryDependencies{
		connectCDP: func(context.Context, cdpClientOptions) (*cdpClient, error) {
			return newBrowserTestCDP(t), nil
		},
	}

	extensionID := "caller-ext"
	launched, err := launchBrowserbaseWithDependencies(context.Background(), BrowserbaseLaunchOptions{
		APIKey: "bb_test", BaseURL: server.URL, ClientOptions: clientOptions, ExtensionID: &extensionID,
	}, dependencies)
	if err != nil {
		t.Fatalf("launchBrowserbaseWithDependencies() error = %v", err)
	}
	if err := launched.Close(context.Background()); err != nil {
		t.Fatalf("launched Browser.Close() error = %v", err)
	}
	wantBody := map[string]any{
		"extensionId": "caller-ext",
		"userMetadata": map[string]any{
			"stagehand":              "true",
			"stagehand_sdk_language": "go",
			"stagehand_sdk_version":  stagehandSDKVersion,
		},
	}
	if !reflect.DeepEqual(sessionCreateBody, wantBody) {
		t.Fatalf("session create body = %#v, want %#v", sessionCreateBody, wantBody)
	}

	connected, err := connectBrowserbaseWithDependencies(context.Background(), BrowserbaseConnectOptions{
		APIKey: "bb_test", BaseURL: server.URL, ClientOptions: clientOptions, SessionID: "session_123",
	}, dependencies)
	if err != nil {
		t.Fatalf("connectBrowserbaseWithDependencies() error = %v", err)
	}
	if err := connected.Close(context.Background()); err != nil {
		t.Fatalf("connected Browser.Close() error = %v", err)
	}

	// launch: create + release; connect: retrieve + release.
	if transport.requests.Load() != 4 {
		t.Fatalf("caller transport requests = %d, want 4", transport.requests.Load())
	}
}
