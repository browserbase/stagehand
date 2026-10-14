package stagehand

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"testing/synctest"
	"time"
)

func TestPageSetContentSerializesHTMLAndOptions(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		name    string
		html    string
		options *PageSetContentOptions
		want    string
	}{
		{"empty HTML", "", nil, `{"page_id":"page-1","html":""}`},
		{"empty options", "<p>Hi</p>", &PageSetContentOptions{}, `{"page_id":"page-1","html":"<p>Hi</p>","options":{}}`},
		{"options", "<p>Hi</p>", &PageSetContentOptions{WaitUntil: new(LoadStateNetworkIdle), Timeout: new(1250.5)}, `{"page_id":"page-1","html":"<p>Hi</p>","options":{"wait_until":"networkidle","timeout":1250.5}}`},
		{"unlimited", "<p>Hi</p>", &PageSetContentOptions{Timeout: new(0.0)}, `{"page_id":"page-1","html":"<p>Hi</p>","options":{"timeout":0}}`},
	} {
		t.Run(test.name, func(t *testing.T) {
			rpc := &recordingProtocolClient{responses: map[string]any{
				"page.set_content": PageVoidResult{Ok: true},
			}}
			page := &Page{rpc: rpc, ref: PageRef{PageID: "page-1"}}
			if err := page.SetContent(context.Background(), test.html, test.options); err != nil {
				t.Fatal(err)
			}
			if len(rpc.calls) != 1 || rpc.calls[0].method != "page.set_content" {
				t.Fatalf("calls = %#v", rpc.calls)
			}
			encoded, err := marshalValidatedJSON(rpc.calls[0].params)
			if err != nil {
				t.Fatal(err)
			}
			assertRPCJSON(t, encoded, test.want)
		})
	}
}

func TestPageSetContentPreservesRPCError(t *testing.T) {
	t.Parallel()
	want := &RPCError{Code: -32000, Message: "page closed"}
	rpc := &recordingProtocolClient{callErrors: map[string]error{"page.set_content": want}}
	page := &Page{rpc: rpc, ref: PageRef{PageID: "page-1"}}
	if err := page.SetContent(context.Background(), "<p>Hi</p>", nil); err != want {
		t.Fatalf("SetContent() error = %v, want original RPC error %v", err, want)
	}
}

func TestSetContentRPCResponseTimeout(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		params  string
		want    time.Duration
		bounded bool
	}{
		{`{}`, 40 * time.Second, true},
		{`{"options":{}}`, 40 * time.Second, true},
		{`{"options":{"timeout":0}}`, 0, false},
		{`{"options":{"timeout":5000}}`, 15 * time.Second, true},
		{`{"options":{"timeout":0.5}}`, 10*time.Second + 500*time.Microsecond, true},
		{`{"options":{"timeout":2147473647}}`, 2147483647 * time.Millisecond, true},
	} {
		if got, bounded := rpcResponseTimeout("page.set_content", json.RawMessage(test.params)); got != test.want || bounded != test.bounded {
			t.Errorf("%s timeout = %v, %t; want %v, %t", test.params, got, bounded, test.want, test.bounded)
		}
	}
}

func TestPageSetContentUnlimitedWaitHonorsCallerContext(t *testing.T) {
	t.Parallel()
	for _, cancelEarly := range []bool{false, true} {
		synctest.Test(t, func(t *testing.T) {
			transport := newQueueRPCTransport()
			client := newTestRPCClient(t, transport)
			page := &Page{rpc: client, ref: PageRef{PageID: "page-1"}}
			ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
			defer cancel()
			done := make(chan error, 1)
			go func() {
				done <- page.SetContent(ctx, "<p>Hi</p>", &PageSetContentOptions{Timeout: new(0.0)})
			}()
			_ = receiveSentRPC(t, transport)
			want := context.DeadlineExceeded
			if cancelEarly {
				cancel()
				want = context.Canceled
			}
			if err := <-done; !errors.Is(err, want) {
				t.Fatalf("SetContent() error = %v, want %v", err, want)
			}
			client.mu.Lock()
			pending := len(client.pending)
			client.mu.Unlock()
			if pending != 0 {
				t.Fatalf("pending requests = %d", pending)
			}
		})
	}
}
