package stagehand

import (
	"bytes"
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"
)

func responseDescriptor() NavigationResponseDescriptor {
	return NavigationResponseDescriptor{
		ResponseID:        "response-1",
		URL:               "https://example.test/final",
		Status:            201,
		StatusText:        "Created",
		Headers:           map[string]string{"content-type": "application/json"},
		FromServiceWorker: true,
	}
}

func TestResponseExposesImmediateMetadataWithDefensiveHeaderCopies(t *testing.T) {
	t.Parallel()

	rpc := &recordingProtocolClient{}
	descriptor := responseDescriptor()
	response := newResponse(rpc, descriptor)
	descriptor.Headers["content-type"] = "mutated before access"

	if response.URL() != "https://example.test/final" {
		t.Fatalf("URL() = %q", response.URL())
	}
	if response.Status() != 201 || response.StatusText() != "Created" {
		t.Fatalf("status = (%d, %q)", response.Status(), response.StatusText())
	}
	if !response.OK() || !response.FromServiceWorker() {
		t.Fatal("response metadata convenience methods returned false")
	}

	headers := response.Headers()
	headers["content-type"] = "mutated after access"
	if got := response.Headers()["content-type"]; got != "application/json" {
		t.Fatalf("Headers()[content-type] = %q", got)
	}
	if len(rpc.calls) != 0 {
		t.Fatalf("immediate metadata made RPC calls: %#v", rpc.calls)
	}
}

func TestResponseRetrievesHeadersAndConnectionMetadataLazily(t *testing.T) {
	t.Parallel()

	rpc := &recordingProtocolClient{responses: map[string]any{
		"response.all_headers": ResponseAllHeadersResult{Headers: map[string]string{
			"Content-Type": "application/json",
			"Set-Cookie":   "first=1\nsecond=2",
		}},
		"response.headers_array": ResponseHeadersArrayResult{Headers: []NavigationHeader{
			{Name: "Set-Cookie", Value: "first=1"},
			{Name: "set-cookie", Value: "second=2"},
			{Name: "X-Empty", Value: ""},
		}},
		"response.security_details": ResponseSecurityDetailsResult{Value: &NavigationSecurityDetails{
			Issuer:      "Example CA",
			Protocol:    "TLS 1.3",
			SubjectName: "example.test",
			ValidFrom:   1,
			ValidTo:     2,
		}},
		"response.server_addr": ResponseServerAddrResult{Value: &NavigationServerAddr{
			IPAddress: "203.0.113.10",
			Port:      443,
		}},
	}}
	response := newResponse(rpc, responseDescriptor())
	ctx := context.Background()

	allHeaders, err := response.AllHeaders(ctx)
	if err != nil || allHeaders["Set-Cookie"] != "first=1\nsecond=2" {
		t.Fatalf("AllHeaders() = (%#v, %v)", allHeaders, err)
	}
	allHeaders["Set-Cookie"] = "mutated"

	headers, err := response.HeadersArray(ctx)
	if err != nil {
		t.Fatalf("HeadersArray() error = %v", err)
	}
	headers[0].Value = "mutated"
	value, present, err := response.HeaderValue(ctx, "SET-cookie")
	if err != nil || !present || value != "first=1, second=2" {
		t.Fatalf("HeaderValue() = (%q, %t, %v)", value, present, err)
	}
	values, err := response.HeaderValues(ctx, "set-COOKIE")
	if err != nil || !reflect.DeepEqual(values, []string{"first=1", "second=2"}) {
		t.Fatalf("HeaderValues() = (%#v, %v)", values, err)
	}
	empty, present, err := response.HeaderValue(ctx, "x-empty")
	if err != nil || !present || empty != "" {
		t.Fatalf("HeaderValue(x-empty) = (%q, %t, %v)", empty, present, err)
	}
	missing, present, err := response.HeaderValue(ctx, "missing")
	if err != nil || present || missing != "" {
		t.Fatalf("HeaderValue(missing) = (%q, %t, %v)", missing, present, err)
	}

	securityDetails, err := response.SecurityDetails(ctx)
	if err != nil || securityDetails == nil || securityDetails.SubjectName != "example.test" {
		t.Fatalf("SecurityDetails() = (%#v, %v)", securityDetails, err)
	}
	serverAddr, err := response.ServerAddr(ctx)
	if err != nil || serverAddr == nil || serverAddr.IPAddress != "203.0.113.10" {
		t.Fatalf("ServerAddr() = (%#v, %v)", serverAddr, err)
	}

	for _, call := range rpc.calls {
		if params, ok := call.params.(ResponseIDParams); !ok || params.ResponseID != "response-1" {
			t.Fatalf("RPC params = %#v", call.params)
		}
	}
}

func TestResponseBodyTextAndJSONUseIndependentRPCCalls(t *testing.T) {
	t.Parallel()

	rpc := &recordingProtocolClient{responses: map[string]any{
		"response.body": ResponseBodyResult{
			Body:          "eyJvayI6dHJ1ZX0=",
			Base64Encoded: true,
		},
	}}
	response := newResponse(rpc, responseDescriptor())
	ctx := context.Background()

	body, err := response.Body(ctx)
	if err != nil || !bytes.Equal(body, []byte(`{"ok":true}`)) {
		t.Fatalf("Body() = (%q, %v)", body, err)
	}
	text, err := response.Text(ctx)
	if err != nil || text != `{"ok":true}` {
		t.Fatalf("Text() = (%q, %v)", text, err)
	}
	var decoded struct {
		OK bool `json:"ok"`
	}
	if err := response.JSON(ctx, &decoded); err != nil || !decoded.OK {
		t.Fatalf("JSON() = (%#v, %v)", decoded, err)
	}
	if got := len(rpc.calls); got != 3 {
		t.Fatalf("response.body RPC calls = %d, want 3", got)
	}
}

func TestResponseSurfacesFinishedTransportAndMalformedBodyErrors(t *testing.T) {
	t.Parallel()

	rpc := &recordingProtocolClient{
		responses: map[string]any{
			"response.finished": ResponseFinishedResult{
				Error: &NavigationFinishedError{Message: "net::ERR_FAILED"},
			},
			"response.body": ResponseBodyResult{Body: "%%%", Base64Encoded: true},
		},
		callErrors: map[string]error{
			"response.all_headers": errors.New("handle unavailable"),
		},
	}
	response := newResponse(rpc, responseDescriptor())
	ctx := context.Background()

	if err := response.Finished(ctx); err == nil || err.Error() != "net::ERR_FAILED" {
		t.Fatalf("Finished() error = %v", err)
	}
	if _, err := response.Body(ctx); err == nil || !strings.Contains(err.Error(), "invalid base64") {
		t.Fatalf("Body() error = %v", err)
	}
	if _, err := response.AllHeaders(ctx); err == nil || err.Error() != "handle unavailable" {
		t.Fatalf("AllHeaders() error = %v", err)
	}
}

func TestResponseFinishedAndOptionalMetadataCanReturnNil(t *testing.T) {
	t.Parallel()

	rpc := &recordingProtocolClient{responses: map[string]any{
		"response.finished":         ResponseFinishedResult{},
		"response.security_details": ResponseSecurityDetailsResult{},
		"response.server_addr":      ResponseServerAddrResult{},
	}}
	response := newResponse(rpc, responseDescriptor())
	ctx := context.Background()

	if err := response.Finished(ctx); err != nil {
		t.Fatalf("Finished() error = %v", err)
	}
	if value, err := response.SecurityDetails(ctx); err != nil || value != nil {
		t.Fatalf("SecurityDetails() = (%#v, %v)", value, err)
	}
	if value, err := response.ServerAddr(ctx); err != nil || value != nil {
		t.Fatalf("ServerAddr() = (%#v, %v)", value, err)
	}
}
