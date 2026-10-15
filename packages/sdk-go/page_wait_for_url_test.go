package stagehand

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"testing"
	"time"
)

func TestPageWaitForURLSerializesOptions(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		name    string
		options *PageWaitForURLOptions
		wire    string
	}{
		{"omitted", nil, ""},
		{"load", &PageWaitForURLOptions{WaitUntil: new(PageWaitForURLOptionsWaitUntilLoad)}, `{"wait_until":"load"}`},
		{"domcontentloaded", &PageWaitForURLOptions{WaitUntil: new(PageWaitForURLOptionsWaitUntilDomcontentloaded), Timeout: new(5000)}, `{"wait_until":"domcontentloaded","timeout":5000}`},
		{"unlimited", &PageWaitForURLOptions{Timeout: new(0)}, `{"timeout":0}`},
	} {
		t.Run(test.name, func(t *testing.T) {
			rpc := &recordingProtocolClient{responses: map[string]any{
				"page.wait_for_url": PageVoidResult{Ok: true},
			}}
			page := &Page{rpc: rpc, ref: PageRef{PageID: "page-1"}}
			if err := page.WaitForURL(context.Background(), "**/complete", test.options); err != nil {
				t.Fatalf("WaitForURL() error = %v", err)
			}
			if len(rpc.calls) != 1 || rpc.calls[0].method != "page.wait_for_url" {
				t.Fatalf("RPC calls = %#v", rpc.calls)
			}
			params, ok := rpc.calls[0].params.(PageWaitForURLParams)
			if !ok || params.PageID != "page-1" || params.URL != "**/complete" || params.Options != test.options {
				t.Fatalf("RPC params = %#v", rpc.calls[0].params)
			}
			encoded, err := json.Marshal(params)
			if err != nil {
				t.Fatal(err)
			}
			var wire struct {
				Options map[string]any `json:"options"`
			}
			if err := json.Unmarshal(encoded, &wire); err != nil {
				t.Fatal(err)
			}
			var expectedOptions map[string]any
			if test.wire != "" {
				if err := json.Unmarshal([]byte(test.wire), &expectedOptions); err != nil {
					t.Fatal(err)
				}
			}
			if !reflect.DeepEqual(wire.Options, expectedOptions) {
				t.Fatalf("wire options = %v, want %v", wire.Options, expectedOptions)
			}
		})
	}
}

func TestPageWaitForURLPropagatesErrors(t *testing.T) {
	t.Parallel()
	want := errors.New("waitForURL: page closed")
	rpc := &recordingProtocolClient{callErrors: map[string]error{"page.wait_for_url": want}}
	page := &Page{rpc: rpc, ref: PageRef{PageID: "page-1"}}
	if err := page.WaitForURL(context.Background(), "https://example.com/complete", nil); !errors.Is(err, want) {
		t.Fatalf("WaitForURL() error = %v, want %v", err, want)
	}
}

func TestWaitForURLResponseTimeout(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		params  string
		want    time.Duration
		bounded bool
	}{
		{`{}`, 40 * time.Second, true},
		{`{"options":{}}`, 40 * time.Second, true},
		{`{"options":{"timeout":250}}`, 10*time.Second + 250*time.Millisecond, true},
		{`{"options":{"timeout":45000}}`, 55 * time.Second, true},
		{`{"options":{"timeout":0}}`, 0, false},
	} {
		got, bounded := rpcResponseTimeout("page.wait_for_url", json.RawMessage(test.params))
		if got != test.want || bounded != test.bounded {
			t.Errorf("%s timeout = %v, %t; want %v, %t", test.params, got, bounded, test.want, test.bounded)
		}
	}
}
