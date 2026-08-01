package stagehand

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"
)

func TestSimpleGettersMapGeneratedResults(t *testing.T) {
	t.Parallel()

	domainPolicy := &DomainPolicy{
		AllowedDomains: []string{"example.com"},
		BlockedDomains: []string{"blocked.example"},
	}
	descriptor := LocatorDescriptor{
		PageID:   "page-1",
		Selector: "#target",
		Nth:      testPointer(2),
	}
	tests := []struct {
		name       string
		method     string
		response   any
		want       any
		wantParams any
		invoke     func(*recordingProtocolClient) (any, error)
	}{
		{
			name:       "browser context domain policy",
			method:     "context.get_domain_policy",
			response:   domainPolicy,
			want:       domainPolicy,
			wantParams: EmptyParams{},
			invoke: func(rpc *recordingProtocolClient) (any, error) {
				return (&BrowserContext{rpc: rpc}).GetDomainPolicy(context.Background())
			},
		},
		{
			name:       "page URL",
			method:     "page.url",
			response:   PageURLResult("https://example.com/path"),
			want:       "https://example.com/path",
			wantParams: PageIDParams{PageID: "page-1"},
			invoke: func(rpc *recordingProtocolClient) (any, error) {
				return (&Page{rpc: rpc, ref: PageRef{PageID: "page-1"}}).URL(context.Background())
			},
		},
		{
			name:       "page title",
			method:     "page.title",
			response:   PageTitleResult("Example title"),
			want:       "Example title",
			wantParams: PageIDParams{PageID: "page-1"},
			invoke: func(rpc *recordingProtocolClient) (any, error) {
				return (&Page{rpc: rpc, ref: PageRef{PageID: "page-1"}}).Title(context.Background())
			},
		},
		{
			name:       "locator checked state",
			method:     "locator.is_checked",
			response:   LocatorIsCheckedResult(true),
			want:       true,
			wantParams: descriptor,
			invoke: func(rpc *recordingProtocolClient) (any, error) {
				return (&PageLocator{rpc: rpc, descriptor: descriptor}).IsChecked(context.Background())
			},
		},
		{
			name:       "locator input value",
			method:     "locator.input_value",
			response:   LocatorInputValueResult("typed value"),
			want:       "typed value",
			wantParams: descriptor,
			invoke: func(rpc *recordingProtocolClient) (any, error) {
				return (&PageLocator{rpc: rpc, descriptor: descriptor}).InputValue(context.Background())
			},
		},
		{
			name:       "locator visibility",
			method:     "locator.is_visible",
			response:   LocatorIsVisibleResult(true),
			want:       true,
			wantParams: descriptor,
			invoke: func(rpc *recordingProtocolClient) (any, error) {
				return (&PageLocator{rpc: rpc, descriptor: descriptor}).IsVisible(context.Background())
			},
		},
		{
			name:       "locator inner text",
			method:     "locator.inner_text",
			response:   LocatorInnerTextResult("rendered text"),
			want:       "rendered text",
			wantParams: descriptor,
			invoke: func(rpc *recordingProtocolClient) (any, error) {
				return (&PageLocator{rpc: rpc, descriptor: descriptor}).InnerText(context.Background())
			},
		},
		{
			name:       "locator inner HTML",
			method:     "locator.inner_html",
			response:   LocatorInnerHTMLResult("<strong>content</strong>"),
			want:       "<strong>content</strong>",
			wantParams: descriptor,
			invoke: func(rpc *recordingProtocolClient) (any, error) {
				return (&PageLocator{rpc: rpc, descriptor: descriptor}).InnerHTML(context.Background())
			},
		},
		{
			name:       "locator text content",
			method:     "locator.text_content",
			response:   LocatorTextContentResult("raw text"),
			want:       "raw text",
			wantParams: descriptor,
			invoke: func(rpc *recordingProtocolClient) (any, error) {
				return (&PageLocator{rpc: rpc, descriptor: descriptor}).TextContent(context.Background())
			},
		},
	}

	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			rpc := &recordingProtocolClient{responses: map[string]any{
				test.method: test.response,
			}}
			got, err := test.invoke(rpc)
			if err != nil {
				t.Fatalf("getter error = %v", err)
			}
			if !reflect.DeepEqual(got, test.want) {
				t.Fatalf("getter result = %#v, want %#v", got, test.want)
			}
			if len(rpc.calls) != 1 {
				t.Fatalf("RPC calls = %#v, want one call", rpc.calls)
			}
			if rpc.calls[0].method != test.method {
				t.Fatalf("RPC method = %q, want %q", rpc.calls[0].method, test.method)
			}
			if !reflect.DeepEqual(rpc.calls[0].params, test.wantParams) {
				t.Fatalf("RPC params = %#v, want %#v", rpc.calls[0].params, test.wantParams)
			}
		})
	}
}

func TestStagehandOperationsPreserveResultEnvelopes(t *testing.T) {
	t.Parallel()

	page := &Page{ref: PageRef{PageID: "page-1"}}
	tests := []struct {
		name     string
		method   string
		response any
		invoke   func(*Stagehand) (any, error)
	}{
		{
			name:   "act",
			method: "stagehand.act",
			response: ActResult{
				Data: ActResultData{
					Success:           true,
					Message:           "clicked",
					ActionDescription: "click submit",
					Actions:           []Action{},
				},
				Metadata: StagehandResultMetadata{
					ActionID:      testPointer("action-act"),
					Cache: &CacheMetadata{Status: CacheStatusMISS},
				},
			},
			invoke: func(client *Stagehand) (any, error) {
				return client.Act(
					context.Background(),
					"click submit",
					&StagehandClientActOptions{Page: page},
				)
			},
		},
		{
			name:   "observe",
			method: "stagehand.observe",
			response: ObserveResult{
				Data: []Action{{
					Description: "Submit button",
					Selector:    "#submit",
				}},
				Metadata: StagehandResultMetadata{
					ActionID:      testPointer("action-observe"),
					Cache: &CacheMetadata{Status: CacheStatusHIT},
				},
			},
			invoke: func(client *Stagehand) (any, error) {
				instruction := "find submit"
				return client.Observe(
					context.Background(),
					&instruction,
					&StagehandClientObserveOptions{Page: page},
				)
			},
		},
		{
			name:   "extract",
			method: "stagehand.extract",
			response: ExtractResult{
				Data: json.RawMessage(`{"heading":"Example"}`),
				Metadata: StagehandResultMetadata{
					ActionID:      testPointer("action-extract"),
					Cache: &CacheMetadata{Status: CacheStatusMISS},
				},
			},
			invoke: func(client *Stagehand) (any, error) {
				screenshot := true
				return client.Extract(
					context.Background(),
					"extract heading",
					json.RawMessage(`{"type":"object"}`),
					&StagehandClientExtractOptions{
						ExtractOptions: ExtractOptions{Screenshot: &screenshot},
						Page:           page,
					},
				)
			},
		},
	}

	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			rpc := &recordingProtocolClient{responses: map[string]any{
				test.method: test.response,
			}}
			page.rpc = rpc
			client := &Stagehand{initialized: true, rpc: rpc}
			got, err := test.invoke(client)
			if err != nil {
				t.Fatalf("%s error = %v", test.name, err)
			}
			if !reflect.DeepEqual(got, test.response) {
				t.Fatalf("%s result = %#v, want full envelope %#v", test.name, got, test.response)
			}
			if len(rpc.calls) != 1 || rpc.calls[0].method != test.method {
				t.Fatalf("%s RPC calls = %#v", test.name, rpc.calls)
			}

			if test.method != "stagehand.extract" {
				return
			}
			params, ok := rpc.calls[0].params.(StagehandExtractParams)
			if !ok || params.Options == nil || params.Options.Screenshot == nil ||
				!*params.Options.Screenshot {
				t.Fatalf("Extract() screenshot params = %#v", rpc.calls[0].params)
			}
		})
	}
}
