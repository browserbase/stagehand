package stagehand

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestConnectLocalBrowserForwardsHeaders(t *testing.T) {
	for _, test := range []struct {
		name    string
		headers map[string]string
	}{
		{"nil", nil}, {"empty", map[string]string{}},
		{"credentials", map[string]string{"Authorization": "Bearer test-token", "X-Api-Key": "test-key"}},
	} {
		for _, direct := range []bool{false, true} {
			name := "discovery"
			if direct {
				name = "direct"
			}
			t.Run(test.name+"/"+name, func(t *testing.T) {
				requests := make(chan *http.Request, 2)
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					requests <- r
					if r.URL.Path == "/json/version" {
						_ = json.NewEncoder(w).Encode(map[string]string{"webSocketDebuggerUrl": "ws://" + r.Host + "/browser"})
						return
					}
					// Stop at the real handshake, before extension discovery.
					http.Error(w, "stop handshake", http.StatusForbidden)
				}))
				defer server.Close()
				endpoint := server.URL
				if direct {
					endpoint = "ws" + strings.TrimPrefix(endpoint, "http") + "/browser"
				}
				ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
				defer cancel()
				_, err := ConnectLocalBrowser(ctx, LocalBrowserConnectOptions{CDPURL: endpoint, Headers: test.headers})
				if err == nil {
					t.Fatal("expected rejected handshake")
				}
				count := 2
				if direct {
					count = 1
				}
				if len(requests) != count {
					t.Fatalf("received %d requests, want %d; error: %v", len(requests), count, err)
				}
				for i := 0; i < count; i++ {
					request := <-requests
					for _, name := range []string{"Authorization", "X-Api-Key"} {
						if got := request.Header.Get(name); got != test.headers[name] {
							t.Errorf("%s header = %q, want %q", name, got, test.headers[name])
						}
					}
					if i == count-1 && request.Header.Get("Upgrade") != "websocket" {
						t.Error("last request was not a WebSocket handshake")
					}
				}
			})
		}
	}
}

func TestConnectLocalBrowserHeadersStayClientSide(t *testing.T) {
	for _, extensionURL := range []string{"", "ws://localhost:9222/browser"} {
		t.Run(extensionURL, func(t *testing.T) {
			headers := map[string]string{"X-Api-Key": "test-key"}
			var connected cdpClientOptions
			browser, err := connectLocalBrowserWithDependencies(context.Background(), LocalBrowserConnectOptions{
				CDPURL: "wss://gateway/browser", Headers: headers, ExtensionCDPURL: extensionURL,
			}, browserFactoryDependencies{connectCDP: func(_ context.Context, options cdpClientOptions) (*cdpClient, error) {
				connected = options
				return newBrowserTestCDP(t), nil
			}})
			if err != nil {
				t.Fatal(err)
			}
			defer browser.cdp.Close()
			if !reflect.DeepEqual(connected.headers, http.Header{"X-Api-Key": {"test-key"}}) {
				t.Fatalf("unexpected client headers: %#v", connected.headers)
			}
			headers["X-Api-Key"] = "changed"
			if connected.headers.Get("X-Api-Key") != "test-key" {
				t.Fatal("client headers alias caller map")
			}
			claimed, err := claimBrowser(browser)
			if err != nil {
				t.Fatal(err)
			}
			if claimed.workerCDPURL != extensionURL || claimed.workerAPIKey != nil || claimed.workerBrowser != nil {
				t.Fatal("unexpected extension initialization metadata")
			}
		})
	}
}
