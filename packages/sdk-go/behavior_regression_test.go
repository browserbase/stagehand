package stagehand

import (
	"context"
	"encoding/json"
	"reflect"
	"strings"
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
					ActionID: testPointer("action-act"),
					Cache:    CacheMetadata{Status: CacheStatusMISS},
				},
			},
			invoke: func(client *Stagehand) (any, error) {
				return client.Act(
					context.Background(),
					ActInstruction("click submit"),
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
					ActionID: testPointer("action-observe"),
					Cache:    CacheMetadata{Status: CacheStatusHIT},
				},
			},
			invoke: func(client *Stagehand) (any, error) {
				instruction := "find submit"
				return client.Observe(
					context.Background(),
					&instruction,
					&StagehandClientObserveOptions{
						Page:           page,
						Locator:        page.Locator("main"),
						IgnoreLocators: []*PageLocator{mustNth(t, page.Locator("nav"), 1)},
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
		})
	}
}

func TestExtractDerivesSchemaAndPreservesTypedDataAndMetadata(t *testing.T) {
	t.Parallel()

	type tag struct {
		Name string `json:"name"`
	}
	type pageInfo struct {
		Heading string  `json:"heading" jsonschema:"description=the page heading"`
		Tags    []tag   `json:"tags"`
		Summary *string `json:"summary,omitempty"`
	}

	metadata := StagehandResultMetadata{
		ActionID: testPointer("action-extract"),
		Cache:    CacheMetadata{Status: CacheStatusHIT},
	}
	rpc := &recordingProtocolClient{responses: map[string]any{
		"stagehand.extract": ExtractResult{
			Data:     json.RawMessage(`{"heading":"Example","tags":[{"name":"docs"}]}`),
			Metadata: metadata,
		},
	}}
	page := &Page{rpc: rpc, ref: PageRef{PageID: "page-1"}}
	client := &Stagehand{initialized: true, rpc: rpc}

	screenshot := true
	result, err := Extract[pageInfo](
		context.Background(),
		client,
		"extract heading",
		&StagehandClientExtractOptions{
			Page:       page,
			Screenshot: &screenshot,
		},
	)
	if err != nil {
		t.Fatalf("Extract() error = %v", err)
	}
	if result.Data.Heading != "Example" || !reflect.DeepEqual(result.Data.Tags, []tag{{Name: "docs"}}) {
		t.Fatalf("Extract() data = %#v", result.Data)
	}
	if !reflect.DeepEqual(result.Metadata, metadata) {
		t.Fatalf("Extract() metadata = %#v, want %#v", result.Metadata, metadata)
	}
	if len(rpc.calls) != 1 || rpc.calls[0].method != "stagehand.extract" {
		t.Fatalf("Extract() RPC calls = %#v", rpc.calls)
	}
	params, ok := rpc.calls[0].params.(StagehandExtractParams)
	if !ok || params.Options == nil || params.Options.Screenshot == nil ||
		!*params.Options.Screenshot {
		t.Fatalf("Extract() params = %#v", rpc.calls[0].params)
	}
	var schema map[string]any
	if err := json.Unmarshal(params.Schema, &schema); err != nil {
		t.Fatalf("decode derived schema: %v", err)
	}
	rootSchema := resolveLocalSchemaReference(t, schema, schema)
	if rootSchema["type"] != "object" || rootSchema["additionalProperties"] != false {
		t.Fatalf("derived schema root = %#v", schema)
	}
	if !reflect.DeepEqual(rootSchema["required"], []any{"heading", "tags"}) {
		t.Fatalf("derived schema required = %#v", rootSchema["required"])
	}
	properties, ok := rootSchema["properties"].(map[string]any)
	if !ok {
		t.Fatalf("derived schema properties = %#v", rootSchema["properties"])
	}
	heading, ok := properties["heading"].(map[string]any)
	if !ok || heading["description"] != "the page heading" {
		t.Fatalf("derived heading schema = %#v", properties["heading"])
	}
	tags, ok := properties["tags"].(map[string]any)
	if !ok || tags["type"] != "array" {
		t.Fatalf("derived tags schema = %#v", properties["tags"])
	}
	items, ok := tags["items"].(map[string]any)
	if !ok {
		t.Fatalf("derived tags item schema = %#v", tags["items"])
	}
	itemRef, ok := items["$ref"].(string)
	if !ok || !strings.HasPrefix(itemRef, "#/$defs/") {
		t.Fatalf("derived tags item reference = %#v", items)
	}
	itemSchema := resolveLocalSchemaReference(t, schema, items)
	if itemSchema["type"] != "object" || itemSchema["additionalProperties"] != false {
		t.Fatalf("derived tags item definition = %#v", itemSchema)
	}
	if !reflect.DeepEqual(itemSchema["required"], []any{"name"}) {
		t.Fatalf("derived tags item required = %#v", itemSchema["required"])
	}
}

func TestStagehandObserveAndExtractSerializePageLocators(t *testing.T) {
	t.Parallel()

	type pageInfo struct {
		Heading string `json:"heading"`
	}

	rpc := &recordingProtocolClient{responses: map[string]any{
		"stagehand.observe": ObserveResult{Metadata: StagehandResultMetadata{
			Cache: CacheMetadata{Status: CacheStatusDISABLED},
		}},
		"stagehand.extract": ExtractResult{
			Data: json.RawMessage(`{"heading":"Example"}`),
			Metadata: StagehandResultMetadata{
				Cache: CacheMetadata{Status: CacheStatusDISABLED},
			},
		},
	}}
	page := &Page{rpc: rpc, ref: PageRef{PageID: "page-1"}}
	client := &Stagehand{initialized: true, rpc: rpc}

	instruction := "find main"
	if _, err := client.Observe(context.Background(), &instruction, &StagehandClientObserveOptions{
		Page:           page,
		Locator:        mustNth(t, page.Locator("main"), 1),
		IgnoreLocators: []*PageLocator{page.Locator("nav")},
	}); err != nil {
		t.Fatalf("Observe() error = %v", err)
	}
	if _, err := Extract[pageInfo](context.Background(), client, "extract main", &StagehandClientExtractOptions{
		Page:           page,
		Locator:        page.Locator("main"),
		IgnoreLocators: []*PageLocator{mustNth(t, page.Locator(".ad"), 2)},
	}); err != nil {
		t.Fatalf("Extract() error = %v", err)
	}

	observeParams, ok := rpc.calls[0].params.(StagehandObserveParams)
	if !ok || observeParams.Options == nil || observeParams.Options.Locator == nil {
		t.Fatalf("observe params = %#v", rpc.calls[0].params)
	}
	if observeParams.Options.Locator.Selector != "main" ||
		observeParams.Options.Locator.Nth == nil ||
		*observeParams.Options.Locator.Nth != 1 {
		t.Fatalf("observe locator = %#v", observeParams.Options.Locator)
	}
	if len(observeParams.Options.IgnoreLocators) != 1 ||
		observeParams.Options.IgnoreLocators[0].Selector != "nav" {
		t.Fatalf("observe ignore locators = %#v", observeParams.Options.IgnoreLocators)
	}

	extractParams, ok := rpc.calls[1].params.(StagehandExtractParams)
	if !ok || extractParams.Options == nil || extractParams.Options.Locator == nil {
		t.Fatalf("extract params = %#v", rpc.calls[1].params)
	}
	if extractParams.Options.Locator.Selector != "main" {
		t.Fatalf("extract locator = %#v", extractParams.Options.Locator)
	}
	if len(extractParams.Options.IgnoreLocators) != 1 ||
		extractParams.Options.IgnoreLocators[0].Selector != ".ad" ||
		extractParams.Options.IgnoreLocators[0].Nth == nil ||
		*extractParams.Options.IgnoreLocators[0].Nth != 2 {
		t.Fatalf("extract ignore locators = %#v", extractParams.Options.IgnoreLocators)
	}
}

func TestStagehandObserveAndExtractRejectCrossPageLocators(t *testing.T) {
	t.Parallel()

	type pageInfo struct {
		Heading string `json:"heading"`
	}

	rpc := &recordingProtocolClient{responses: map[string]any{}}
	page := &Page{rpc: rpc, ref: PageRef{PageID: "page-1"}}
	otherPage := &Page{rpc: rpc, ref: PageRef{PageID: "page-2"}}
	client := &Stagehand{initialized: true, rpc: rpc}

	instruction := "find main"
	if _, err := client.Observe(context.Background(), &instruction, &StagehandClientObserveOptions{
		Page:    page,
		Locator: otherPage.Locator("main"),
	}); err == nil || !strings.Contains(err.Error(), "stagehand.Observe: locator must belong") {
		t.Fatalf("Observe() error = %v", err)
	}
	if _, err := Extract[pageInfo](context.Background(), client, "extract main", &StagehandClientExtractOptions{
		Page:           page,
		IgnoreLocators: []*PageLocator{otherPage.Locator("nav")},
	}); err == nil || !strings.Contains(err.Error(), "stagehand.Extract: locator must belong") {
		t.Fatalf("Extract() error = %v", err)
	}
}

func TestStagehandObserveAndExtractRejectNilIgnoreLocators(t *testing.T) {
	t.Parallel()

	type pageInfo struct {
		Heading string `json:"heading"`
	}

	tests := []struct {
		name    string
		method  string
		run     func(context.Context, *Stagehand, *Page) error
		wantErr string
	}{
		{
			name:   "observe",
			method: "stagehand.Observe",
			run: func(ctx context.Context, client *Stagehand, page *Page) error {
				instruction := "find main"
				_, err := client.Observe(ctx, &instruction, &StagehandClientObserveOptions{
					Page:           page,
					IgnoreLocators: []*PageLocator{nil},
				})
				return err
			},
			wantErr: "stagehand.Observe: ignore locator at index 0 is nil",
		},
		{
			name:   "extract",
			method: "stagehand.Extract",
			run: func(ctx context.Context, client *Stagehand, page *Page) error {
				_, err := Extract[pageInfo](ctx, client, "extract main", &StagehandClientExtractOptions{
					Page:           page,
					IgnoreLocators: []*PageLocator{nil},
				})
				return err
			},
			wantErr: "stagehand.Extract: ignore locator at index 0 is nil",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			rpc := &recordingProtocolClient{responses: map[string]any{}}
			page := &Page{rpc: rpc, ref: PageRef{PageID: "page-1"}}
			client := &Stagehand{initialized: true, rpc: rpc}

			err := tt.run(context.Background(), client, page)
			if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
				t.Fatalf("%s error = %v", tt.method, err)
			}
			if len(rpc.calls) != 0 {
				t.Fatalf("%s RPC calls = %#v", tt.method, rpc.calls)
			}
		})
	}
}

func TestSchemaForTypeSupportsRecursiveTypes(t *testing.T) {
	t.Parallel()

	type node struct {
		Value    string  `json:"value"`
		Children []*node `json:"children,omitempty"`
	}

	rawSchema, err := schemaForType(reflect.TypeFor[node]())
	if err != nil {
		t.Fatalf("schemaForType() error = %v", err)
	}
	var schema map[string]any
	if err := json.Unmarshal(rawSchema, &schema); err != nil {
		t.Fatalf("decode recursive schema: %v", err)
	}
	rootSchema := resolveLocalSchemaReference(t, schema, schema)
	properties, ok := rootSchema["properties"].(map[string]any)
	if !ok {
		t.Fatalf("recursive schema properties = %#v", rootSchema["properties"])
	}
	children, ok := properties["children"].(map[string]any)
	if !ok {
		t.Fatalf("recursive children schema = %#v", properties["children"])
	}
	items, ok := children["items"].(map[string]any)
	if !ok {
		t.Fatalf("recursive children items = %#v", children["items"])
	}
	nodeRef, ok := items["$ref"].(string)
	if !ok || !strings.HasPrefix(nodeRef, "#/$defs/") {
		t.Fatalf("recursive node reference = %#v", items)
	}
	resolveLocalSchemaReference(t, schema, items)
}

func resolveLocalSchemaReference(
	t *testing.T,
	document map[string]any,
	candidate map[string]any,
) map[string]any {
	t.Helper()

	reference, ok := candidate["$ref"].(string)
	if !ok {
		return candidate
	}
	const prefix = "#/$defs/"
	if !strings.HasPrefix(reference, prefix) {
		t.Fatalf("schema reference = %q, want local definition", reference)
	}
	definitions, ok := document["$defs"].(map[string]any)
	if !ok {
		t.Fatalf("schema definitions = %#v", document["$defs"])
	}
	resolved, ok := definitions[strings.TrimPrefix(reference, prefix)].(map[string]any)
	if !ok {
		t.Fatalf("schema definition missing for %q", reference)
	}
	return resolved
}

func TestExtractRejectsNilClient(t *testing.T) {
	t.Parallel()

	if _, err := Extract[struct{}](context.Background(), nil, "extract", nil); err == nil {
		t.Fatal("Extract() error = nil, want missing client error")
	}
}

func TestExtractPreservesMetadataOnDecodeError(t *testing.T) {
	t.Parallel()

	type pageInfo struct {
		Heading string `json:"heading"`
	}

	metadata := StagehandResultMetadata{
		ActionID: testPointer("action-extract"),
		Cache:    CacheMetadata{Status: CacheStatusHIT},
	}
	rpc := &recordingProtocolClient{responses: map[string]any{
		"stagehand.extract": ExtractResult{
			Data:     json.RawMessage(`{"heading":42}`),
			Metadata: metadata,
		},
	}}
	page := &Page{rpc: rpc, ref: PageRef{PageID: "page-1"}}
	client := &Stagehand{initialized: true, rpc: rpc}

	result, err := Extract[pageInfo](
		context.Background(),
		client,
		"extract heading",
		&StagehandClientExtractOptions{Page: page},
	)
	if err == nil {
		t.Fatal("Extract() error = nil, want typed decode error")
	}
	if result.Data.Heading != "" {
		t.Fatalf("Extract() data = %#v, want zero value", result.Data)
	}
	if !reflect.DeepEqual(result.Metadata, metadata) {
		t.Fatalf("Extract() metadata = %#v, want %#v", result.Metadata, metadata)
	}
}

func mustNth(t *testing.T, locator *PageLocator, index int) *PageLocator {
	t.Helper()

	nth, err := locator.Nth(index)
	if err != nil {
		t.Fatalf("Locator.Nth(%d) error = %v", index, err)
	}
	return nth
}
