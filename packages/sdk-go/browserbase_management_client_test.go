package stagehand

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"reflect"
	"strings"
	"testing"
)

type managementTestTransport struct {
	roundTrip func(*http.Request) (*http.Response, error)
	closes    int
}

func (transport *managementTestTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	return transport.roundTrip(request)
}

func (transport *managementTestTransport) CloseIdleConnections() {
	transport.closes++
}

func TestBrowserbaseInjectedClientLifecycle(t *testing.T) {
	for _, scenario := range []string{"launch", "connect", "create failure"} {
		t.Run(scenario, func(t *testing.T) {
			var calls []string
			transport := &managementTestTransport{roundTrip: func(request *http.Request) (*http.Response, error) {
				calls = append(calls, request.Method+" "+request.URL.Path)
				if request.URL.Host != "management.example" || request.Header.Get("X-BB-API-Key") != "management-key" {
					t.Errorf("management routing = %s, key = %q", request.URL, request.Header.Get("X-BB-API-Key"))
				}
				status := http.StatusOK
				var response any
				switch request.Method + " " + request.URL.Path {
				case "POST /v1/extensions":
					response = browserbaseTestExtensionResponse("ext_stagehand")
				case "POST /v1/sessions":
					var payload map[string]json.RawMessage
					if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
						t.Fatal(err)
					}
					for _, key := range []string{"client", "Client", "apiKey", "baseUrl"} {
						if _, exists := payload[key]; exists {
							t.Errorf("session payload contains SDK-only %s", key)
						}
					}
					response = browserbaseTestCreateSessionResponse("session_123")
					if scenario == "create failure" {
						status = http.StatusBadRequest
						response = map[string]string{"message": "invalid session"}
					}
				case "GET /v1/sessions/session_123":
					response = browserbaseTestCreateSessionResponse("session_123")
				case "POST /v1/sessions/session_123":
					response = browserbaseTestSessionResponse("session_123", "COMPLETED")
				case "DELETE /v1/extensions/ext_stagehand":
					status = http.StatusNoContent
				default:
					t.Fatalf("unexpected request: %s %s", request.Method, request.URL)
				}
				body, err := json.Marshal(response)
				if err != nil {
					t.Fatal(err)
				}
				return &http.Response{
					StatusCode: status, Header: http.Header{"Content-Type": []string{"application/json"}},
					Body: io.NopCloser(strings.NewReader(string(body))), Request: request,
				}, nil
			}}
			client, err := NewBrowserbaseClient(BrowserbaseClientOptions{
				APIKey: "management-key", BaseURL: "https://management.example",
				HTTPClient: &http.Client{Transport: transport},
			})
			if err != nil {
				t.Fatal(err)
			}
			dependencies := browserFactoryDependencies{
				connectCDP: func(context.Context, cdpClientOptions) (*cdpClient, error) {
					return newBrowserTestCDP(t), nil
				},
			}
			var browser *Browser
			if scenario == "connect" {
				browser, err = connectBrowserbaseWithDependencies(context.Background(), BrowserbaseConnectOptions{
					APIKey: "runtime-key", BaseURL: "https://ignored.example", Client: client, SessionID: "session_123",
				}, dependencies)
			} else {
				browser, err = launchBrowserbaseWithDependencies(context.Background(), BrowserbaseLaunchOptions{
					APIKey: "runtime-key", BaseURL: "https://ignored.example", Client: client,
				}, dependencies)
			}
			if scenario == "create failure" {
				if err == nil || !strings.Contains(err.Error(), "create a Browserbase session") {
					t.Fatalf("launch error = %v", err)
				}
			} else {
				if err != nil {
					t.Fatal(err)
				}
				claimed, err := claimBrowser(browser)
				if err != nil {
					t.Fatal(err)
				}
				if claimed.workerAPIKey == nil || *claimed.workerAPIKey != "runtime-key" {
					t.Fatalf("runtime key = %v", claimed.workerAPIKey)
				}
				releaseBrowserClaim(browser)
				if err := browser.Close(context.Background()); err != nil {
					t.Fatal(err)
				}
			}
			want := []string{"POST /v1/extensions", "POST /v1/sessions"}
			if scenario == "connect" {
				want = []string{"GET /v1/sessions/session_123"}
			}
			if scenario != "create failure" {
				want = append(want, "POST /v1/sessions/session_123")
			}
			if scenario != "connect" {
				want = append(want, "DELETE /v1/extensions/ext_stagehand")
			}
			if !reflect.DeepEqual(calls, want) {
				t.Fatalf("calls = %v, want %v", calls, want)
			}
			if _, err := client.api.retrieveSession(context.Background(), "session_123"); err != nil {
				t.Fatalf("reuse client: %v", err)
			}
			if transport.closes != 0 {
				t.Fatalf("caller transport closed %d times", transport.closes)
			}
		})
	}
}

func TestBrowserbaseClientValidation(t *testing.T) {
	negativeRetries := -1
	for _, options := range []BrowserbaseClientOptions{
		{},
		{APIKey: "key", BaseURL: "invalid"},
		{APIKey: "key", MaxRetries: &negativeRetries},
	} {
		if _, err := NewBrowserbaseClient(options); err == nil {
			t.Fatalf("expected invalid configuration error for %+v", options)
		}
	}
	zeroRetries := 0
	client, err := NewBrowserbaseClient(BrowserbaseClientOptions{APIKey: "key", MaxRetries: &zeroRetries})
	if err != nil {
		t.Fatal(err)
	}
	if client.api.maxRetries != 0 || client.api.baseURL != defaultBrowserbaseBaseURL {
		t.Fatalf("client options = %#v", client.api)
	}
	if _, err := browserbaseClientForFactory("", "", client, browserFactoryDependencies{}); err == nil {
		t.Fatal("runtime API key must remain required")
	}
	if _, err := browserbaseClientForFactory("key", "", &BrowserbaseClient{}, browserFactoryDependencies{}); err == nil {
		t.Fatal("zero-value client must be rejected")
	}
}
