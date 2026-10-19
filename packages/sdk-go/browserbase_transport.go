package stagehand

import (
	"bytes"
	"context"
	"errors"
	"io"
	"math"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

// These headers are supplied by the HTTP client or the SDK connection.
func filterBrowserbaseRequestHeaders(headers http.Header) {
	omitted := map[string]bool{
		"host": true, "content-length": true, "connection": true, "keep-alive": true,
		"proxy-authenticate": true, "proxy-authorization": true, "proxy-connection": true,
		"te": true, "trailer": true, "transfer-encoding": true, "upgrade": true,
		"forwarded": true, "x-bb-api-key": true, "x-bb-session-id": true,
	}
	for _, value := range headers.Values("Connection") {
		for _, name := range strings.Split(value, ",") {
			omitted[strings.ToLower(strings.TrimSpace(name))] = true
		}
	}
	for name := range headers {
		lower := strings.ToLower(name)
		if omitted[lower] || strings.HasPrefix(lower, "x-forwarded-") {
			headers.Del(name)
		}
	}
}

type browserbaseHTTPExecutor struct {
	connection *browserbaseConnection
	client     *http.Client
}

func newBrowserbaseHTTPExecutor(connection *browserbaseConnection) *browserbaseHTTPExecutor {
	if connection != nil {
		snapshot := *connection
		connection = &snapshot
	}
	return &browserbaseHTTPExecutor{
		connection: connection,
		client: &http.Client{
			Transport: &http.Transport{
				Proxy: http.ProxyFromEnvironment, ForceAttemptHTTP2: true,
				IdleConnTimeout: 90 * time.Second,
			},
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		},
	}
}

func (executor *browserbaseHTTPExecutor) close() {
	executor.client.CloseIdleConnections()
}

// execute performs one Browserbase HTTP attempt; the worker interprets the response.
func (executor *browserbaseHTTPExecutor) execute(ctx context.Context, params BrowserbaseRequestParams) (BrowserbaseRequestResult, error) {
	if ctx == nil {
		return BrowserbaseRequestResult{}, errors.New("Browserbase request context is required")
	}
	if _, err := marshalValidatedJSON(params); err != nil {
		return BrowserbaseRequestResult{}, errors.New("invalid Browserbase request params")
	}
	if params.RemainingTimeoutMs != nil && *params.RemainingTimeoutMs < 0 {
		return BrowserbaseRequestResult{}, errors.New("invalid Browserbase request budget")
	}
	var path string
	switch params.Operation {
	case BrowserbaseRequestParamsOperationGatewayResponses:
		path = "/llm/responses"
	case BrowserbaseRequestParamsOperationCacheGet:
		path = "/cache/get"
	case BrowserbaseRequestParamsOperationCacheSet:
		path = "/cache/set"
	default:
		return BrowserbaseRequestResult{}, errors.New("invalid Browserbase operation")
	}
	if executor.connection == nil {
		return browserbaseHTTPError(BrowserbaseTransportErrorReasonUnavailable, "Browserbase connection is unavailable"), nil
	}
	ctx, cancel := browserbaseHTTPContext(ctx, params.RemainingTimeoutMs)
	defer cancel()

	// A non-rewindable body prevents net/http from replaying these POSTs, even with idempotency headers.
	request, err := http.NewRequestWithContext(ctx, http.MethodPost,
		executor.connection.apiURL+path, io.NopCloser(strings.NewReader(params.Body)))
	if err != nil || (request.URL.Scheme != "http" && request.URL.Scheme != "https") || request.URL.Host == "" {
		return BrowserbaseRequestResult{}, errors.New("invalid Browserbase HTTP request")
	}
	request.ContentLength = int64(len(params.Body))
	keys := make([]string, 0, len(params.Headers))
	for key := range params.Headers {
		keys = append(keys, key)
	}
	slices.Sort(keys)
	for _, key := range keys {
		value := params.Headers[key]
		if !validBrowserbaseHeaderName(key) || !validBrowserbaseHeaderValue(value) ||
			strings.IndexFunc(value, func(r rune) bool { return r > 255 }) >= 0 {
			return BrowserbaseRequestResult{}, errors.New("invalid Browserbase HTTP header")
		}
		request.Header.Add(key, strings.Trim(value, " \t"))
	}
	filterBrowserbaseRequestHeaders(request.Header)
	if _, present := request.Header["Content-Type"]; !present {
		request.Header.Set("Content-Type", "application/json")
	}
	request.Header.Set("X-BB-API-Key", executor.connection.apiKey)
	if params.Operation == BrowserbaseRequestParamsOperationGatewayResponses {
		request.Header.Set("X-BB-Session-ID", executor.connection.sessionID)
		if _, present := request.Header["Authorization"]; !present {
			request.Header.Set("Authorization", "Bearer "+executor.connection.apiKey)
		}
	}
	// Fetch headers use single-byte values; Go strings otherwise write UTF-8 bytes.
	for key, values := range request.Header {
		for i, value := range values {
			if !validBrowserbaseHeaderValue(value) {
				return BrowserbaseRequestResult{}, errors.New("invalid Browserbase HTTP header value")
			}
			var encoded strings.Builder
			for _, r := range value {
				if r > 255 {
					return BrowserbaseRequestResult{}, errors.New("invalid Browserbase HTTP header value")
				}
				encoded.WriteByte(byte(r))
			}
			request.Header[key][i] = encoded.String()
		}
	}
	if ctx.Err() != nil {
		return browserbaseHTTPFailure(ctx), nil
	}
	response, err := executor.client.Do(request)
	if err != nil {
		return browserbaseHTTPFailure(ctx), nil
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		return browserbaseHTTPFailure(ctx), nil
	}
	headers := make(BrowserbaseHTTPResponseHeaders, len(response.Header))
	for key, values := range response.Header {
		key = strings.ToLower(key)
		if key != "content-encoding" && key != "content-length" {
			var value strings.Builder
			for _, b := range []byte(strings.Join(values, ", ")) {
				value.WriteRune(rune(b))
			}
			headers[key] = value.String()
		}
	}
	return NewBrowserbaseHTTPResponse(BrowserbaseHTTPResponse{
		Status:     response.StatusCode,
		StatusText: strings.TrimPrefix(response.Status, strconv.Itoa(response.StatusCode)+" "),
		Headers:    headers, Body: browserbaseHTTPText(body),
	}), nil
}

func browserbaseHTTPContext(ctx context.Context, milliseconds *float64) (context.Context, context.CancelFunc) {
	if milliseconds != nil {
		nanoseconds := math.Ceil(*milliseconds * float64(time.Millisecond))
		// Budgets beyond time.Duration's range must not overflow into an immediate timeout.
		if nanoseconds < float64(math.MaxInt64) {
			return context.WithTimeout(ctx, time.Duration(nanoseconds))
		}
	}
	return context.WithCancel(ctx)
}

func browserbaseHTTPError(reason BrowserbaseTransportErrorReason, message string) BrowserbaseRequestResult {
	return NewBrowserbaseTransportError(BrowserbaseTransportError{Reason: reason, Message: message})
}

func browserbaseHTTPFailure(ctx context.Context) BrowserbaseRequestResult {
	if errors.Is(context.Cause(ctx), context.DeadlineExceeded) {
		return browserbaseHTTPError(BrowserbaseTransportErrorReasonTimeout, "Browserbase request timed out")
	}
	if ctx.Err() != nil {
		return browserbaseHTTPError(BrowserbaseTransportErrorReasonCancelled, "Browserbase request cancelled")
	}
	return browserbaseHTTPError(BrowserbaseTransportErrorReasonNetwork, "Browserbase HTTP request failed")
}

func browserbaseHTTPText(body []byte) string {
	body = bytes.TrimPrefix(body, []byte{0xef, 0xbb, 0xbf})
	if utf8.Valid(body) {
		return string(body)
	}
	var text strings.Builder
	for len(body) > 0 {
		r, size := utf8.DecodeRune(body)
		if r == utf8.RuneError && size == 1 {
			// Replace an incomplete UTF-8 sequence once, matching fetch text decoding.
			for size < len(body) && !utf8.FullRune(body[:size+1]) {
				size++
			}
		}
		text.WriteRune(r)
		body = body[size:]
	}
	return text.String()
}
