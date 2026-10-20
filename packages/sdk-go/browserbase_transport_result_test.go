package stagehand

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestBrowserbaseRequestResultPreservesHTTPResponse(t *testing.T) {
	want := BrowserbaseHTTPResponse{
		Type: "response", Status: 429, StatusText: "Too Many Requests",
		Headers: BrowserbaseHTTPResponseHeaders{"Retry-After": "2"}, Body: "upstream error: héllo 🌎",
	}
	encoded, err := json.Marshal(NewBrowserbaseHTTPResponse(want))
	if err != nil {
		t.Fatal(err)
	}
	var decoded BrowserbaseRequestResult
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatal(err)
	}
	if response, ok := decoded.AsResponse(); !ok || !reflect.DeepEqual(response, want) {
		t.Fatalf("unexpected HTTP response: %#v", response)
	}
	if _, ok := decoded.AsError(); ok {
		t.Fatal("HTTP failure decoded as a transport error")
	}
	roundTrip, err := json.Marshal(decoded)
	if err != nil || !jsonEqual(encoded, roundTrip) {
		t.Fatalf("HTTP response changed: %s, %v", roundTrip, err)
	}
}

func TestBrowserbaseRequestResultTransportErrors(t *testing.T) {
	for _, reason := range []BrowserbaseTransportErrorReason{
		BrowserbaseTransportErrorReasonNetwork, BrowserbaseTransportErrorReasonCancelled,
		BrowserbaseTransportErrorReasonTimeout, BrowserbaseTransportErrorReasonUnavailable,
		BrowserbaseTransportErrorReasonDisconnected,
	} {
		t.Run(string(reason), func(t *testing.T) {
			result := NewBrowserbaseTransportError(BrowserbaseTransportError{Reason: reason, Message: "Request did not complete"})
			encoded, err := json.Marshal(result)
			if err != nil {
				t.Fatal(err)
			}
			var decoded BrowserbaseRequestResult
			if err := json.Unmarshal(encoded, &decoded); err != nil {
				t.Fatal(err)
			}
			transportError, ok := decoded.AsError()
			if !ok || transportError.Type != "error" || transportError.Reason != reason || transportError.Message != "Request did not complete" {
				t.Fatalf("unexpected transport error: %#v", transportError)
			}
			if _, ok := decoded.AsResponse(); ok {
				t.Fatal("transport error decoded as HTTP response")
			}
		})
	}
}

func TestBrowserbaseRequestResultRejectsInvalidVariants(t *testing.T) {
	for _, input := range []string{
		`null`, `[]`, `{}`, `{"type":"other"}`, `{"type":"response"}`,
		`{"type":"error","reason":"network"}`,
		`{"type":"error","reason":"network","message":"failed","status":503}`,
		`{"type":"response","status":200,"status_text":"OK","headers":{},"body":"","reason":"network"}`,
	} {
		t.Run(input, func(t *testing.T) {
			var result BrowserbaseRequestResult
			if err := json.Unmarshal([]byte(input), &result); err == nil {
				t.Fatal("expected invalid variant to fail")
			}
		})
	}
	if _, err := json.Marshal(BrowserbaseRequestResult{}); err == nil {
		t.Fatal("expected unset result to fail")
	}
	var result *BrowserbaseRequestResult
	if err := result.UnmarshalJSON([]byte(`{}`)); err == nil {
		t.Fatal("expected nil receiver to fail")
	}
}
