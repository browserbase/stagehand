package stagehand

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"reflect"
	"strings"
	"sync/atomic"
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

func TestCDPHeaderValidation(t *testing.T) {
	for _, pair := range [][2]string{{"", "secret"}, {"bad name", "secret"}, {"bad\n", "secret"}, {"X-Key", "secret\n"}, {"X-Key", " secret"}, {"X-Key", "secret\t"}, {"X-Key", "secret\x00"}, {"X-Key", "secret\x7f"}, {"X-Key", "sécret"}} {
		called := false
		_, err := connectLocalBrowserWithDependencies(context.Background(), LocalBrowserConnectOptions{CDPURL: "ws://gw", Headers: map[string]string{pair[0]: pair[1]}}, browserFactoryDependencies{connectCDP: func(context.Context, cdpClientOptions) (*cdpClient, error) {
			called = true
			return nil, errors.New("unexpected connect")
		}})
		if err == nil || !strings.Contains(err.Error(), "headers must map") || strings.Contains(err.Error(), "secret") || called {
			t.Fatalf("unexpected validation outcome: %v, connected=%v", err, called)
		}
	}
	for _, value := range []string{"", "Bearer token", "internal space\ttab"} {
		if err := validateCDPHeader("X-Key", value); err != nil {
			t.Fatal(err)
		}
	}
}

func TestCanForwardCDPHeaders(t *testing.T) {
	for _, test := range []struct {
		source, destination string
		want                bool
	}{
		{"https://gw", "wss://gw:443/browser", true},
		{"https://gw", "wss://gw:0443/browser", true},
		{"https://gw:0", "wss://gw:0/browser", false}, {"http://gw", "ws://gw:80/browser", true},
		{"http://gw:443", "wss://gw/browser", true}, {"https://gw", "ws://gw:443/browser", false},
		{"https://gw", "wss://other/browser", false}, {"https://gw", "wss://gw:9443/browser", false},
		{"https://gw", "file://gw/browser", false}, {"%", "wss://gw", false},
	} {
		if got := canForwardCDPHeaders(test.source, test.destination); got != test.want {
			t.Errorf("%s -> %s = %v", test.source, test.destination, got)
		}
	}
}

func TestCDPRedirects(t *testing.T) {
	for _, direct := range []bool{false, true} {
		for _, crossPort := range []bool{false, true} {
			for _, authenticated := range []bool{false, true} {
				t.Run(fmt.Sprintf("websocket=%v/crossPort=%v/headers=%v", direct, crossPort, authenticated), func(t *testing.T) {
					var reached atomic.Int32
					target := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						reached.Add(1)
						if authenticated && r.Header.Get("X-Key") != "secret" {
							t.Error("missing header at allowed destination")
						}
						if direct {
							http.Error(w, "stop handshake", http.StatusForbidden)
							return
						}
						_ = json.NewEncoder(w).Encode(map[string]string{"webSocketDebuggerUrl": "ws://gw/browser"})
					})
					destination := httptest.NewServer(target)
					defer destination.Close()
					source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						if r.URL.Path == "/final" {
							target.ServeHTTP(w, r)
							return
						}
						location := "/final"
						if crossPort {
							location = destination.URL + "/final"
						}
						http.Redirect(w, r, location, http.StatusFound)
					}))
					defer source.Close()
					var headers http.Header
					if authenticated {
						headers = http.Header{"X-Key": {"secret"}}
					}
					ctx, cancel := context.WithTimeout(context.Background(), time.Second)
					defer cancel()
					var err error
					if direct {
						_, err = dialCDPWebSocket(ctx, "ws"+strings.TrimPrefix(source.URL, "http"), headers, nil)
					} else {
						_, err = resolveBrowserWebSocketURL(ctx, source.URL, headers, nil)
					}
					if crossPort && authenticated {
						if !errors.Is(err, errUnsafeCDPRedirect) || reached.Load() != 0 {
							t.Fatalf("unsafe redirect: reached=%d error=%v", reached.Load(), err)
						}
					} else if reached.Load() != 1 {
						t.Fatalf("allowed redirect: reached=%d error=%v", reached.Load(), err)
					}
				})
			}
		}
	}
}

func TestCDPDiscoveryAuthenticationErrors(t *testing.T) {
	for _, status := range []int{401, 403} {
		for _, headers := range []http.Header{nil, {}, {"X-Key": {"secret"}}} {
			var calls atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1); http.Error(w, "secret-response", status) }))
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			_, err := resolveBrowserWebSocketURL(ctx, server.URL+"?token=secret", headers, nil)
			cancel()
			server.Close()
			if err == nil || !strings.Contains(err.Error(), fmt.Sprintf("HTTP %d", status)) || strings.Contains(err.Error(), "secret") || calls.Load() != 1 {
				t.Fatalf("status=%d calls=%d error=%v", status, calls.Load(), err)
			}
		}
	}
}

func TestCDPDiscoveryRetriesTransientStatus(t *testing.T) {
	for _, status := range []int{429, 500, 503} {
		var calls atomic.Int32
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if calls.Add(1) == 1 {
				http.Error(w, "temporary failure", status)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]string{"webSocketDebuggerUrl": "ws://gw/browser"})
		}))
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		_, err := resolveBrowserWebSocketURL(ctx, server.URL, http.Header{"X-Key": {"secret"}}, nil)
		cancel()
		server.Close()
		if err != nil || calls.Load() != 2 {
			t.Fatalf("status=%d calls=%d error=%v", status, calls.Load(), err)
		}
	}
}

func TestCDPAdvertisedEndpointWithholdsHeaders(t *testing.T) {
	var logs bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&logs, &slog.HandlerOptions{Level: slog.LevelDebug})))
	defer slog.SetDefault(previous)
	received := make(chan string, 1)
	destination := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		received <- r.Header.Get("X-Key")
		http.Error(w, "stop", 403)
	}))
	defer destination.Close()
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]string{"webSocketDebuggerUrl": "ws" + strings.TrimPrefix(destination.URL, "http")})
	}))
	defer source.Close()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	_, err := ConnectLocalBrowser(ctx, LocalBrowserConnectOptions{CDPURL: source.URL, Headers: map[string]string{"X-Key": "secret"}})
	if err == nil {
		t.Fatal("expected rejected handshake")
	}
	select {
	case got := <-received:
		if got != "" {
			t.Fatal("credential reached other endpoint")
		}
	default:
		t.Fatal("missing handshake")
	}
	if !strings.Contains(logs.String(), "headers were withheld") {
		t.Fatal("missing diagnostic")
	}
	for _, secret := range []string{"secret", "X-Key", source.URL, destination.URL} {
		if strings.Contains(logs.String(), secret) {
			t.Fatal("diagnostic exposed credentials or URLs")
		}
	}
}

func TestCDPRedirectClientPreservesCallerPolicy(t *testing.T) {
	calls := 0
	client := &http.Client{Timeout: time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { calls++; return http.ErrUseLastResponse }}
	guarded := cdpHTTPClientWithHeaders(client, http.Header{"X-Key": {"secret"}})
	source, _ := http.NewRequest("GET", "https://gw/start", nil)
	same, _ := http.NewRequest("GET", "https://gw/final", nil)
	insecure, _ := http.NewRequest("GET", "http://gw:443/final", nil)
	if err := guarded.CheckRedirect(same, []*http.Request{source}); err != http.ErrUseLastResponse {
		t.Fatal(err)
	}
	if err := guarded.CheckRedirect(insecure, []*http.Request{source}); !errors.Is(err, errUnsafeCDPRedirect) {
		t.Fatal(err)
	}
	if calls != 1 || guarded == client || guarded.Timeout != client.Timeout {
		t.Fatal("caller client policy changed")
	}
	if err := client.CheckRedirect(insecure, []*http.Request{source}); err != http.ErrUseLastResponse {
		t.Fatal("original client modified")
	}
}

func TestCDPRedirectLoopFailsImmediately(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, "/loop", 302) }))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	_, err := resolveBrowserWebSocketURL(ctx, server.URL, http.Header{"X-Key": {"secret"}}, nil)
	if !errors.Is(err, errCDPRedirectLimit) {
		t.Fatalf("redirect loop error = %v", err)
	}
}

func TestCDPAuthenticatedHandshakeErrorOmitsResponseAndURL(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Error(w, "secret-response", 403) }))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	_, err := dialCDPWebSocket(ctx, "ws"+strings.TrimPrefix(server.URL, "http")+"?token=secret-url", http.Header{"X-Key": {"secret-header"}}, nil)
	if err == nil || !strings.Contains(err.Error(), "HTTP 403") || strings.Contains(err.Error(), "secret") {
		t.Fatalf("unexpected handshake error: %v", err)
	}
}

func TestCDPRejectsDuplicateHeaderNames(t *testing.T) {
	for _, second := range []string{"secret-one", "secret-two"} {
		called := false
		_, err := connectLocalBrowserWithDependencies(context.Background(), LocalBrowserConnectOptions{
			CDPURL: "ws://gw", Headers: map[string]string{"X-Secret": "secret-one", "x-secret": second},
		}, browserFactoryDependencies{connectCDP: func(context.Context, cdpClientOptions) (*cdpClient, error) {
			called = true
			return nil, errors.New("unexpected connection")
		}})
		if err == nil || err.Error() != "headers must not contain duplicate names ignoring case" || called {
			t.Fatalf("duplicate validation: error=%v connected=%v", err, called)
		}
	}
}

func TestCDPRedirectRevalidatesCallbackURL(t *testing.T) {
	for _, destination := range []string{"https://other/final", "https://gw:9443/final", "http://gw:443/final", "https://secret@gw/final", ""} {
		t.Run(destination, func(t *testing.T) {
			source, _ := http.NewRequest("GET", "https://gw/start", nil)
			request, _ := http.NewRequest("GET", "https://gw/final", nil)
			client := &http.Client{CheckRedirect: func(req *http.Request, via []*http.Request) error {
				if destination == "" {
					req.URL = nil
				} else {
					req.URL, _ = url.Parse(destination)
				}
				// Mutating the previous request must not change the captured trust boundary.
				via[0].URL, _ = url.Parse("https://other/start")
				return nil
			}}
			err := cdpHTTPClientWithHeaders(client, http.Header{"X-Key": {"secret"}}).CheckRedirect(request, []*http.Request{source})
			if !errors.Is(err, errUnsafeCDPRedirect) {
				t.Fatalf("rewrite error = %v", err)
			}
		})
	}
	for _, callbackError := range []error{nil, http.ErrUseLastResponse, errors.New("caller policy")} {
		source, _ := http.NewRequest("GET", "https://gw/start", nil)
		request, _ := http.NewRequest("GET", "https://gw/final", nil)
		client := &http.Client{CheckRedirect: func(req *http.Request, _ []*http.Request) error { req.URL.Path = "/allowed"; return callbackError }}
		err := cdpHTTPClientWithHeaders(client, http.Header{"X-Key": {"secret"}}).CheckRedirect(request, []*http.Request{source})
		if err != callbackError {
			t.Fatalf("callback result = %v, want %v", err, callbackError)
		}
	}
}

func TestCDPRedirectRewriteDoesNotSendCredentials(t *testing.T) {
	for _, direct := range []bool{false, true} {
		t.Run(fmt.Sprintf("websocket=%v", direct), func(t *testing.T) {
			var reached atomic.Int32
			destination := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { reached.Add(1); http.Error(w, "unexpected", 403) }))
			defer destination.Close()
			source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, "/allowed", 302) }))
			defer source.Close()
			client := &http.Client{CheckRedirect: func(req *http.Request, _ []*http.Request) error { req.URL, _ = url.Parse(destination.URL); return nil }}
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			headers := http.Header{"X-Key": {"secret"}}
			var err error
			if direct {
				_, err = dialCDPWebSocket(ctx, "ws"+strings.TrimPrefix(source.URL, "http"), headers, client)
			} else {
				_, err = resolveBrowserWebSocketURL(ctx, source.URL, headers, client)
			}
			if !errors.Is(err, errUnsafeCDPRedirect) || reached.Load() != 0 {
				t.Fatalf("rewritten redirect: error=%v requests=%d", err, reached.Load())
			}
		})
	}
}
