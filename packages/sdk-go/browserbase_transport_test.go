package stagehand

import (
	"bytes"
	"compress/gzip"
	"context"
	"errors"
	"io"
	"maps"
	"math"
	"net"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func testBrowserbaseHTTPParams() BrowserbaseRequestParams {
	return BrowserbaseRequestParams{
		Operation: BrowserbaseRequestParamsOperationGatewayResponses,
		Headers:   BrowserbaseRequestParamsHeaders{}, Body: `{ "input": "héllo" }`,
	}
}

func testBrowserbaseHTTPExecutor(t *testing.T, handler http.HandlerFunc) *browserbaseHTTPExecutor {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	executor := newBrowserbaseHTTPExecutor(&browserbaseConnection{
		apiKey: "bb-fixture-key", apiURL: server.URL + "/services/v1", sessionID: "session-fixture",
	})
	t.Cleanup(executor.close)
	return executor
}

func testBrowserbaseHTTPResponse(t *testing.T, executor *browserbaseHTTPExecutor, params BrowserbaseRequestParams) BrowserbaseHTTPResponse {
	t.Helper()
	result, err := executor.execute(context.Background(), params)
	if err != nil {
		t.Fatal(err)
	}
	response, ok := result.AsResponse()
	if !ok {
		t.Fatalf("expected HTTP response, got %#v", result)
	}
	return response
}

func testBrowserbaseHTTPFailure(t *testing.T, result BrowserbaseRequestResult, err error, reason BrowserbaseTransportErrorReason) {
	t.Helper()
	failure, ok := result.AsError()
	if err != nil || !ok || failure.Reason != reason {
		t.Fatalf("result = %#v, err = %v; want %s", result, err, reason)
	}
}

func TestBrowserbaseHTTPRoutesAndBody(t *testing.T) {
	for operation, path := range map[BrowserbaseRequestParamsOperation]string{
		BrowserbaseRequestParamsOperationGatewayResponses: "/llm/responses",
		BrowserbaseRequestParamsOperationCacheGet:         "/cache/get",
		BrowserbaseRequestParamsOperationCacheSet:         "/cache/set",
	} {
		t.Run(string(operation), func(t *testing.T) {
			params := testBrowserbaseHTTPParams()
			params.Operation = operation
			executor := testBrowserbaseHTTPExecutor(t, func(w http.ResponseWriter, r *http.Request) {
				body, err := io.ReadAll(r.Body)
				if err != nil || string(body) != params.Body || r.Method != "POST" || r.URL.Path != "/services/v1"+path {
					t.Errorf("unexpected request: %s %s %q, error %v", r.Method, r.URL.Path, body, err)
				}
				if r.Header.Get("X-BB-API-Key") != "bb-fixture-key" || r.Header.Get("Content-Type") != "application/json" {
					t.Errorf("unexpected headers: %v", r.Header)
				}
				if operation != BrowserbaseRequestParamsOperationGatewayResponses && (r.Header.Get("Authorization") != "" || r.Header.Get("X-BB-Session-ID") != "") {
					t.Error("cache request received Gateway defaults")
				}
				io.WriteString(w, `{"success":false,"message":"passed through"}`)
			})
			response := testBrowserbaseHTTPResponse(t, executor, params)
			if response.Status != 200 || response.StatusText != "OK" || response.Body != `{"success":false,"message":"passed through"}` {
				t.Fatalf("response = %#v", response)
			}
		})
	}
}

func TestBrowserbaseHTTPSharedFixtures(t *testing.T) {
	var fixtures struct {
		Gateway struct {
			Headers []struct {
				Name       string            `json:"name"`
				Configured map[string]string `json:"configured"`
				Expected   map[string]string `json:"expected"`
			} `json:"headers"`
		} `json:"gateway"`
		HTTPFailures []struct {
			Name    string            `json:"name"`
			Status  int               `json:"status"`
			Headers map[string]string `json:"headers"`
			Body    string            `json:"body"`
		} `json:"httpFailures"`
	}
	loadBrowserbaseTransportFixture(t, &fixtures)
	for _, fixture := range fixtures.Gateway.Headers {
		t.Run(fixture.Name, func(t *testing.T) {
			executor := testBrowserbaseHTTPExecutor(t, func(w http.ResponseWriter, r *http.Request) {
				for key, want := range fixture.Expected {
					if got := r.Header.Get(key); got != want {
						t.Errorf("header %s = %q, want %q", key, got, want)
					}
				}
				io.WriteString(w, "  opaque héllo 🌎\n")
			})
			params := testBrowserbaseHTTPParams()
			params.Headers = maps.Clone(fixture.Configured)
			response := testBrowserbaseHTTPResponse(t, executor, params)
			if response.Body != "  opaque héllo 🌎\n" || !reflect.DeepEqual(params.Headers, BrowserbaseRequestParamsHeaders(fixture.Configured)) {
				t.Fatal("request headers or response body changed")
			}
		})
	}
	for _, fixture := range fixtures.HTTPFailures {
		t.Run(fixture.Name, func(t *testing.T) {
			var attempts atomic.Int32
			executor := testBrowserbaseHTTPExecutor(t, func(w http.ResponseWriter, r *http.Request) {
				attempts.Add(1)
				for key, value := range fixture.Headers {
					w.Header().Set(key, value)
				}
				w.WriteHeader(fixture.Status)
				io.WriteString(w, fixture.Body)
			})
			response := testBrowserbaseHTTPResponse(t, executor, testBrowserbaseHTTPParams())
			if response.Status != fixture.Status || response.Body != fixture.Body || attempts.Load() != 1 {
				t.Fatalf("response = %#v, attempts = %d", response, attempts.Load())
			}
			for key, value := range fixture.Headers {
				if response.Headers[key] != value {
					t.Errorf("response header %s = %q", key, response.Headers[key])
				}
			}
		})
	}
}

func TestBrowserbaseHTTPRequestHeaderRules(t *testing.T) {
	var fixtures struct {
		RequestHeaders []struct {
			Name       string
			Configured BrowserbaseRequestParamsHeaders
			Expected   map[string]string
			Absent     []string
		}
	}
	loadBrowserbaseTransportFixture(t, &fixtures)
	for _, fixture := range fixtures.RequestHeaders {
		for _, operation := range []BrowserbaseRequestParamsOperation{BrowserbaseRequestParamsOperationGatewayResponses, BrowserbaseRequestParamsOperationCacheGet, BrowserbaseRequestParamsOperationCacheSet} {
			t.Run(fixture.Name+"/"+string(operation), func(t *testing.T) {
				params := testBrowserbaseHTTPParams()
				params.Operation, params.Headers = operation, maps.Clone(fixture.Configured)
				executor := testBrowserbaseHTTPExecutor(t, func(w http.ResponseWriter, r *http.Request) {
					for name, want := range fixture.Expected {
						var expectedBytes []byte
						for _, character := range want {
							expectedBytes = append(expectedBytes, byte(character))
						}
						if got := r.Header.Get(name); got != string(expectedBytes) {
							t.Errorf("header %s = %q, want %q", name, got, string(expectedBytes))
						}
					}
					if r.Host != r.Context().Value(http.LocalAddrContextKey).(net.Addr).String() {
						t.Errorf("unexpected Host %q", r.Host)
					}
					body, _ := io.ReadAll(r.Body)
					if string(body) != params.Body || r.ContentLength != int64(len(params.Body)) {
						t.Error("body or length changed")
					}
					for _, name := range fixture.Absent {
						if len(r.Header.Values(name)) != 0 {
							t.Errorf("unexpected header %s", name)
						}
					}
					for _, name := range []string{"x-remove", "x-other", "authorization"} {
						if strings.Contains(strings.ToLower(r.Header.Get("Connection")), name) {
							t.Error("supplied Connection forwarded")
						}
					}
					wantSession := ""
					if operation == BrowserbaseRequestParamsOperationGatewayResponses {
						wantSession = "session-fixture"
					}
					if r.Header.Get("X-BB-API-Key") != "bb-fixture-key" || r.Header.Get("X-BB-Session-ID") != wantSession {
						t.Error("incorrect connection headers")
					}
					if _, custom := fixture.Expected["authorization"]; !custom {
						want := ""
						if operation == BrowserbaseRequestParamsOperationGatewayResponses {
							want = "Bearer bb-fixture-key"
						}
						if r.Header.Get("Authorization") != want {
							t.Error("incorrect default Authorization")
						}
					}
				})
				testBrowserbaseHTTPResponse(t, executor, params)
				if !reflect.DeepEqual(params.Headers, fixture.Configured) {
					t.Fatal("input headers changed")
				}
			})
		}
	}
}

func TestBrowserbaseHTTPHeaderPrecedence(t *testing.T) {
	executor := testBrowserbaseHTTPExecutor(t, func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Values("X-BB-API-Key"); !reflect.DeepEqual(got, []string{"bb-fixture-key"}) {
			t.Errorf("API headers = %v", got)
		}
		if r.Header.Get("X-BB-Session-ID") != "session-fixture" || r.Header.Get("Authorization") != "" || r.Header.Get("Content-Type") != "application/custom+json" {
			t.Errorf("headers = %v", r.Header)
		}
		if r.Header.Get("X-Note") != "caf\xe9" {
			t.Errorf("header bytes = %q", r.Header.Get("X-Note"))
		}
		w.Header().Set("X-Note", "caf\xe9")
		w.Header().Add("X-Repeated", "one")
		w.Header().Add("X-Repeated", "two")
	})
	params := testBrowserbaseHTTPParams()
	params.Headers = BrowserbaseRequestParamsHeaders{
		"x-bb-api-key": "first", "X-BB-API-KEY": "second", "X-BB-SESSION-ID": "custom",
		"Authorization": "", "Content-Type": "application/custom+json", "X-Note": "café",
	}
	response := testBrowserbaseHTTPResponse(t, executor, params)
	if response.Headers["x-repeated"] != "one, two" || response.Headers["x-note"] != "café" {
		t.Fatalf("headers = %v", response.Headers)
	}
}

func TestBrowserbaseHTTPBufferedResponse(t *testing.T) {
	for _, compressed := range []bool{false, true} {
		t.Run(map[bool]string{false: "plain", true: "native gzip"}[compressed], func(t *testing.T) {
			body := strings.Repeat("héllo 🌎", 100_000)
			wireBody := append([]byte{0xef, 0xbb, 0xbf}, []byte(body)...)
			if compressed {
				var buffer bytes.Buffer
				writer := gzip.NewWriter(&buffer)
				if _, err := writer.Write(wireBody); err != nil {
					t.Fatal(err)
				}
				if err := writer.Close(); err != nil {
					t.Fatal(err)
				}
				wireBody = buffer.Bytes()
			}
			executor := testBrowserbaseHTTPExecutor(t, func(w http.ResponseWriter, r *http.Request) {
				requestBody, _ := io.ReadAll(r.Body)
				if string(requestBody) != body {
					t.Error("large request body changed")
				}
				if compressed {
					if r.Header.Get("Accept-Encoding") != "gzip" {
						t.Error("expected native gzip negotiation")
					}
					w.Header().Set("Content-Encoding", "gzip")
				}
				w.Header().Set("Content-Type", "text/plain; charset=latin-1")
				w.Write(wireBody)
			})
			params := testBrowserbaseHTTPParams()
			params.Body = body
			response := testBrowserbaseHTTPResponse(t, executor, params)
			if response.Body != body {
				t.Fatal("decoded response changed")
			}
			if _, ok := response.Headers["content-encoding"]; ok {
				t.Fatal("stale content encoding")
			}
			if _, ok := response.Headers["content-length"]; ok {
				t.Fatal("stale content length")
			}
		})
	}
}

func TestBrowserbaseHTTPText(t *testing.T) {
	for _, test := range []struct{ input, want string }{
		{"héllo 🌎", "héllo 🌎"}, {"\xef\xbb\xbfhi", "hi"}, {"\xff\xff", "\ufffd\ufffd"},
		{"\xe1\x80", "\ufffd"}, {"\xe1\x80a", "\ufffda"}, {"\xe0\x80", "\ufffd\ufffd"},
		{"\xf0\x90\x80", "\ufffd"}, {"\xf4\x90\x80\x80", "\ufffd\ufffd\ufffd\ufffd"},
	} {
		if got := browserbaseHTTPText([]byte(test.input)); got != test.want {
			t.Errorf("decode %q = %q, want %q", test.input, got, test.want)
		}
	}
}

func TestBrowserbaseHTTPRedirectsAndEmptyBodies(t *testing.T) {
	for _, status := range []int{200, 204, 307} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			var attempts atomic.Int32
			executor := testBrowserbaseHTTPExecutor(t, func(w http.ResponseWriter, r *http.Request) {
				attempts.Add(1)
				w.Header().Set("Location", "/redirected")
				w.WriteHeader(status)
			})
			response := testBrowserbaseHTTPResponse(t, executor, testBrowserbaseHTTPParams())
			if response.Status != status || response.Body != "" || attempts.Load() != 1 {
				t.Fatalf("response = %#v", response)
			}
		})
	}
	t.Run("other origin", func(t *testing.T) {
		var attempts atomic.Int32
		target := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { attempts.Add(1) }))
		defer target.Close()
		executor := testBrowserbaseHTTPExecutor(t, func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Location", target.URL)
			w.WriteHeader(307)
		})
		response := testBrowserbaseHTTPResponse(t, executor, testBrowserbaseHTTPParams())
		if response.Status != 307 || attempts.Load() != 0 {
			t.Fatal("redirect was followed")
		}
	})
}

func TestBrowserbaseHTTPCancellationAndDeadlines(t *testing.T) {
	for _, phase := range []string{"headers", "body"} {
		for _, mode := range []string{"cancel", "deadline", "parent deadline", "timeout cause"} {
			t.Run(phase+"/"+mode, func(t *testing.T) {
				received, disconnected := make(chan struct{}), make(chan struct{})
				executor := testBrowserbaseHTTPExecutor(t, func(w http.ResponseWriter, r *http.Request) {
					io.Copy(io.Discard, r.Body)
					if phase == "body" {
						w.Header().Set("Content-Length", "10")
						w.WriteHeader(200)
						w.(http.Flusher).Flush()
					}
					close(received)
					<-r.Context().Done()
					close(disconnected)
				})
				ctx, cancel := context.WithCancelCause(context.Background())
				defer cancel(nil)
				params := testBrowserbaseHTTPParams()
				reason := BrowserbaseTransportErrorReasonCancelled
				if mode == "deadline" {
					params.RemainingTimeoutMs = testPointer(200.0)
					reason = BrowserbaseTransportErrorReasonTimeout
				}
				if mode == "parent deadline" {
					var stop context.CancelFunc
					ctx, stop = context.WithTimeout(ctx, 200*time.Millisecond)
					defer stop()
					params.RemainingTimeoutMs = testPointer(10_000.0)
					reason = BrowserbaseTransportErrorReasonTimeout
				}
				type outcome struct {
					result BrowserbaseRequestResult
					err    error
				}
				done := make(chan outcome, 1)
				go func() { result, err := executor.execute(ctx, params); done <- outcome{result, err} }()
				awaitBrowserbaseTest(t, received)
				if mode == "cancel" {
					cancel(context.Canceled)
				}
				if mode == "timeout cause" {
					cancel(context.DeadlineExceeded)
					reason = BrowserbaseTransportErrorReasonTimeout
				}
				got := awaitBrowserbaseTest(t, done)
				testBrowserbaseHTTPFailure(t, got.result, got.err, reason)
				awaitBrowserbaseTest(t, disconnected)
			})
		}
	}
}

func TestBrowserbaseHTTPAvailabilityAndBudgets(t *testing.T) {
	params := testBrowserbaseHTTPParams()
	executor := newBrowserbaseHTTPExecutor(nil)
	defer executor.close()
	result, err := executor.execute(context.Background(), params)
	testBrowserbaseHTTPFailure(t, result, err, BrowserbaseTransportErrorReasonUnavailable)
	var attempts atomic.Int32
	executor = testBrowserbaseHTTPExecutor(t, func(w http.ResponseWriter, r *http.Request) { attempts.Add(1) })
	params.RemainingTimeoutMs = testPointer(0.0)
	result, err = executor.execute(context.Background(), params)
	testBrowserbaseHTTPFailure(t, result, err, BrowserbaseTransportErrorReasonTimeout)
	if attempts.Load() != 0 {
		t.Fatal("zero budget sent HTTP")
	}
	params.RemainingTimeoutMs = nil
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	result, err = executor.execute(ctx, params)
	testBrowserbaseHTTPFailure(t, result, err, BrowserbaseTransportErrorReasonCancelled)
	if attempts.Load() != 0 {
		t.Fatal("cancelled request sent HTTP")
	}
	for _, budget := range []*float64{nil, testPointer(3_000_000_000.0), testPointer(math.MaxFloat64)} {
		params.RemainingTimeoutMs = budget
		testBrowserbaseHTTPResponse(t, executor, params)
	}
	transport := executor.client.Transport.(*http.Transport)
	if executor.client.Timeout != 0 || transport.ResponseHeaderTimeout != 0 || transport.TLSHandshakeTimeout != 0 {
		t.Fatal("unexpected HTTP timeout")
	}
}

func TestBrowserbaseHTTPNoReplayAfterReceipt(t *testing.T) {
	for _, body := range []string{"{}", ""} {
		t.Run("body="+body, func(t *testing.T) {
			var attempts, connections atomic.Int32
			server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				io.Copy(io.Discard, r.Body)
				if attempts.Add(1) == 1 {
					io.WriteString(w, "{}")
					return
				}
				conn, _, err := w.(http.Hijacker).Hijack()
				if err != nil {
					t.Error(err)
					return
				}
				conn.Close()
			}))
			server.Config.ConnState = func(_ net.Conn, state http.ConnState) {
				if state == http.StateNew {
					connections.Add(1)
				}
			}
			server.Start()
			defer server.Close()
			executor := newBrowserbaseHTTPExecutor(&browserbaseConnection{"key", server.URL + "/v1", "session"})
			defer executor.close()
			params := testBrowserbaseHTTPParams()
			params.Body = body
			params.Headers["Idempotency-Key"] = "fixture-id"
			testBrowserbaseHTTPResponse(t, executor, params)
			result, err := executor.execute(context.Background(), params)
			testBrowserbaseHTTPFailure(t, result, err, BrowserbaseTransportErrorReasonNetwork)
			if attempts.Load() != 2 || connections.Load() != 1 {
				t.Fatalf("attempts=%d connections=%d", attempts.Load(), connections.Load())
			}
		})
	}
}

func TestBrowserbaseHTTPResponseFailures(t *testing.T) {
	for _, failure := range []string{"incomplete", "gzip"} {
		t.Run(failure, func(t *testing.T) {
			executor := testBrowserbaseHTTPExecutor(t, func(w http.ResponseWriter, r *http.Request) {
				switch failure {
				case "incomplete":
					w.Header().Set("Content-Length", "1000")
				case "gzip":
					w.Header().Set("Content-Encoding", "gzip")
				}
				io.WriteString(w, "invalid")
			})
			result, err := executor.execute(context.Background(), testBrowserbaseHTTPParams())
			testBrowserbaseHTTPFailure(t, result, err, BrowserbaseTransportErrorReasonNetwork)
		})
	}
}

type browserbaseTestRoundTripper func(*http.Request) (*http.Response, error)

func (transport browserbaseTestRoundTripper) RoundTrip(request *http.Request) (*http.Response, error) {
	return transport(request)
}

type browserbaseTestBody struct {
	closed bool
	fail   bool
}

func (body *browserbaseTestBody) Read([]byte) (int, error) {
	if body.fail {
		return 0, errors.New("body failure")
	}
	return 0, io.EOF
}
func (body *browserbaseTestBody) Close() error { body.closed = true; return nil }

func TestBrowserbaseHTTPClosesBodiesAndPreservesReasonPhrase(t *testing.T) {
	for _, fail := range []bool{false, true} {
		body := &browserbaseTestBody{fail: fail}
		executor := newBrowserbaseHTTPExecutor(&browserbaseConnection{"key", "https://fixture.example/v1", "session"})
		executor.client.Transport = browserbaseTestRoundTripper(func(request *http.Request) (*http.Response, error) {
			if request.GetBody != nil {
				t.Error("body is replayable")
			}
			return &http.Response{StatusCode: 200, Status: "200 Custom reason", Header: http.Header{}, Body: body}, nil
		})
		result, err := executor.execute(context.Background(), testBrowserbaseHTTPParams())
		if err != nil {
			t.Fatal(err)
		}
		if fail {
			testBrowserbaseHTTPFailure(t, result, err, BrowserbaseTransportErrorReasonNetwork)
		} else {
			response, _ := result.AsResponse()
			if response.StatusText != "Custom reason" {
				t.Fatalf("status text=%q", response.StatusText)
			}
		}
		if !body.closed {
			t.Fatal("response body not closed")
		}
	}
}

func TestBrowserbaseHTTPValidation(t *testing.T) {
	executor := newBrowserbaseHTTPExecutor(&browserbaseConnection{"key", "https://fixture.example/v1", "session"})
	defer executor.close()
	for _, operation := range []BrowserbaseRequestParamsOperation{"invalid", ""} {
		params := testBrowserbaseHTTPParams()
		params.Operation = operation
		if _, err := executor.execute(context.Background(), params); err == nil {
			t.Fatal("invalid operation accepted")
		}
	}
	for _, budget := range []float64{-1, math.NaN(), math.Inf(1)} {
		params := testBrowserbaseHTTPParams()
		params.RemainingTimeoutMs = &budget
		if _, err := executor.execute(context.Background(), params); err == nil {
			t.Fatal("invalid budget accepted")
		}
	}
	for _, url := range []string{"not-a-url", "ftp://fixture.example", "http://127.0.0.1:invalid"} {
		executor.connection.apiURL = url
		if _, err := executor.execute(context.Background(), testBrowserbaseHTTPParams()); err == nil {
			t.Fatal("invalid URL accepted")
		}
	}
}

func TestBrowserbaseHTTPInvalidHeaders(t *testing.T) {
	var fixtures struct {
		InvalidRequestHeaders []BrowserbaseRequestParamsHeaders
	}
	loadBrowserbaseTransportFixture(t, &fixtures)
	executor := newBrowserbaseHTTPExecutor(&browserbaseConnection{"key", "https://fixture.example/v1", "session"})
	defer executor.close()
	executor.client.Transport = browserbaseTestRoundTripper(func(*http.Request) (*http.Response, error) {
		t.Error("invalid headers reached HTTP transport")
		return nil, errors.New("unexpected request")
	})
	for _, headers := range fixtures.InvalidRequestHeaders {
		params := testBrowserbaseHTTPParams()
		params.Headers = headers
		if _, err := executor.execute(context.Background(), params); err == nil {
			t.Errorf("invalid headers accepted: %v", headers)
		}
	}
}

func TestBrowserbaseHTTPHeaderValueEncoding(t *testing.T) {
	executor := newBrowserbaseHTTPExecutor(&browserbaseConnection{"key", "https://fixture.example/v1", "session"})
	defer executor.close()
	params := testBrowserbaseHTTPParams()
	params.Headers["X-Note"] = "🌎"
	if _, err := executor.execute(context.Background(), params); err == nil {
		t.Fatal("non-byte header value accepted")
	}
}
