package stagehand

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestPageLocatorPropagatesDescriptorAndMapsResults(t *testing.T) {
	t.Parallel()

	rpc := &recordingProtocolClient{responses: map[string]any{
		"locator.count":         LocatorCountResult(3),
		"locator.select_option": LocatorSelectOptionResult{"one"},
	}}
	locator := (&Page{
		rpc: rpc,
		ref: PageRef{PageID: "page-1"},
	}).Locator("button")
	locator, err := locator.Nth(2)
	if err != nil {
		t.Fatalf("Nth(2) error = %v", err)
	}

	if err := locator.Click(context.Background(), nil); err != nil {
		t.Fatalf("Click() error = %v", err)
	}
	count, err := locator.Count(context.Background())
	if err != nil {
		t.Fatalf("Count() error = %v", err)
	}
	if count != 3 {
		t.Fatalf("Count() = %d, want 3", count)
	}
	values, err := locator.SelectOption(context.Background(), StringList{"one"})
	if err != nil {
		t.Fatalf("SelectOption() error = %v", err)
	}
	if len(values) != 1 || values[0] != "one" {
		t.Fatalf("SelectOption() = %#v", values)
	}

	clickParams, ok := rpc.calls[0].params.(LocatorClickParams)
	if !ok ||
		clickParams.PageID != "page-1" ||
		clickParams.Selector != "button" ||
		clickParams.Nth == nil ||
		*clickParams.Nth != 2 {
		t.Fatalf("Click() params = %#v", rpc.calls[0].params)
	}
	selectParams, ok := rpc.calls[2].params.(LocatorSelectOptionParams)
	if !ok ||
		selectParams.Nth == nil ||
		*selectParams.Nth != 2 ||
		len(selectParams.Values) != 1 ||
		selectParams.Values[0] != "one" {
		t.Fatalf("SelectOption() params = %#v", rpc.calls[2].params)
	}
}

func TestPageLocatorFirstAndNthReturnIndependentDescriptors(t *testing.T) {
	t.Parallel()

	base := &PageLocator{descriptor: LocatorDescriptor{PageID: "page-1", Selector: "button"}}
	first := base.First().Descriptor()
	thirdLocator, err := base.Nth(3)
	if err != nil {
		t.Fatalf("Nth(3) error = %v", err)
	}
	third := thirdLocator.Descriptor()
	original := base.Descriptor()
	if first.Nth == nil || *first.Nth != 0 {
		t.Fatalf("First().Descriptor() = %#v", first)
	}
	if third.Nth == nil || *third.Nth != 3 {
		t.Fatalf("Nth(3).Descriptor() = %#v", third)
	}
	if original.Nth != nil {
		t.Fatalf("base Descriptor() was mutated: %#v", original)
	}

	invalid, err := base.Nth(-1)
	if err == nil || err.Error() != "stagehand locator index must be non-negative: -1" {
		t.Fatalf("Nth(-1) error = %v", err)
	}
	if invalid != nil {
		t.Fatalf("Nth(-1) locator = %#v, want nil", invalid)
	}
}

func TestPageLocatorSetInputFilesReadsPathsAndCanClear(t *testing.T) {
	t.Parallel()

	filePath := filepath.Join(t.TempDir(), "hello.txt")
	if err := os.WriteFile(filePath, []byte("hello"), 0o600); err != nil {
		t.Fatal(err)
	}
	rpc := &recordingProtocolClient{}
	locator := (&Page{
		rpc: rpc,
		ref: PageRef{PageID: "page-1"},
	}).Locator("#upload")

	if err := locator.SetInputFiles(context.Background(), []FileInput{FilePath(filePath)}); err != nil {
		t.Fatalf("SetInputFiles(path) error = %v", err)
	}
	lastModified := int64(42)
	payload := FileData("bytes.bin", "application/octet-stream", []byte{0, 127, 255})
	payload.LastModified = &lastModified
	if err := locator.SetInputFiles(
		context.Background(),
		[]FileInput{payload, FileData("message.txt", "", []byte("hello"))},
	); err != nil {
		t.Fatalf("SetInputFiles(payloads) error = %v", err)
	}
	if err := locator.SetInputFiles(context.Background(), nil); err != nil {
		t.Fatalf("SetInputFiles() error = %v", err)
	}
	historicalPath := filepath.Join(t.TempDir(), "historical.txt")
	if err := os.WriteFile(historicalPath, []byte("old"), 0o600); err != nil {
		t.Fatal(err)
	}
	preEpoch := time.Unix(-1, 0)
	if err := os.Chtimes(historicalPath, preEpoch, preEpoch); err != nil {
		t.Fatal(err)
	}
	if err := locator.SetInputFiles(context.Background(), []FileInput{FilePath(historicalPath)}); err != nil {
		t.Fatalf("SetInputFiles(historical path) error = %v", err)
	}

	params, ok := rpc.calls[0].params.(LocatorSetInputFilesParams)
	if !ok || len(params.Files) != 1 {
		t.Fatalf("SetInputFiles(path) params = %#v", rpc.calls[0].params)
	}
	if params.PageID != "page-1" || params.Selector != "#upload" ||
		params.Files[0].Name != "hello.txt" || params.Files[0].Data != "aGVsbG8=" ||
		params.Files[0].LastModified == nil {
		t.Fatalf("SetInputFiles(path) params = %#v", params)
	}
	payloadParams, ok := rpc.calls[1].params.(LocatorSetInputFilesParams)
	if !ok || len(payloadParams.Files) != 2 ||
		payloadParams.Files[0].Name != "bytes.bin" ||
		payloadParams.Files[0].Data != "AH//" ||
		payloadParams.Files[0].MIMEType == nil ||
		*payloadParams.Files[0].MIMEType != "application/octet-stream" ||
		payloadParams.Files[0].LastModified == nil ||
		*payloadParams.Files[0].LastModified != 42 ||
		payloadParams.Files[1].Name != "message.txt" ||
		payloadParams.Files[1].Data != "aGVsbG8=" ||
		payloadParams.Files[1].MIMEType != nil ||
		payloadParams.Files[1].LastModified != nil {
		t.Fatalf("SetInputFiles(payloads) params = %#v", rpc.calls[1].params)
	}
	clearParams, ok := rpc.calls[2].params.(LocatorSetInputFilesParams)
	if !ok || len(clearParams.Files) != 0 {
		t.Fatalf("SetInputFiles() params = %#v", rpc.calls[2].params)
	}
	historicalParams, ok := rpc.calls[3].params.(LocatorSetInputFilesParams)
	if !ok || len(historicalParams.Files) != 1 ||
		historicalParams.Files[0].Name != "historical.txt" ||
		historicalParams.Files[0].Data != "b2xk" ||
		historicalParams.Files[0].LastModified != nil {
		t.Fatalf("SetInputFiles(historical path) params = %#v", rpc.calls[3].params)
	}

	oversizedPath := filepath.Join(t.TempDir(), "oversized.bin")
	file, err := os.Create(oversizedPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := file.Truncate(maxInputFileBytes + 1); err != nil {
		file.Close()
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	if err := locator.SetInputFiles(context.Background(), []FileInput{FilePath(oversizedPath)}); err == nil ||
		err.Error() != "set input files: file is larger than the 50 MiB upload limit" {
		t.Fatalf("SetInputFiles(oversized path) error = %v", err)
	}
	negativeLastModified := int64(-1)
	invalidPayload := FileData("historical.txt", "text/plain", []byte("old"))
	invalidPayload.LastModified = &negativeLastModified
	if err := locator.SetInputFiles(context.Background(), []FileInput{invalidPayload}); err == nil ||
		err.Error() != "set input files: last modified must be non-negative" {
		t.Fatalf("SetInputFiles(negative last modified) error = %v", err)
	}
}

func TestPageLocatorTimeoutOptions(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	cases := []struct {
		method  string
		call    func(*PageLocator, *LocatorOptions) error
		fields  map[string]any
		options map[string]any
	}{
		{"click", func(l *PageLocator, o *LocatorOptions) error {
			button, count := MouseButtonRight, 2
			return l.Click(ctx, &LocatorClickOptions{Timeout: o.Timeout, Button: &button, ClickCount: &count})
		}, nil, map[string]any{"button": "right", "click_count": float64(2)}},
		{"hover", func(l *PageLocator, o *LocatorOptions) error { return l.Hover(ctx, o) }, nil, nil},
		{"fill", func(l *PageLocator, o *LocatorOptions) error { return l.Fill(ctx, "hello", o) }, map[string]any{"value": "hello"}, nil},
		{"count", func(l *PageLocator, o *LocatorOptions) error { _, err := l.Count(ctx, o); return err }, nil, nil},
		{"is_checked", func(l *PageLocator, o *LocatorOptions) error { _, err := l.IsChecked(ctx, o); return err }, nil, nil},
		{"input_value", func(l *PageLocator, o *LocatorOptions) error { _, err := l.InputValue(ctx, o); return err }, nil, nil},
		{"is_visible", func(l *PageLocator, o *LocatorOptions) error { _, err := l.IsVisible(ctx, o); return err }, nil, nil},
		{"inner_text", func(l *PageLocator, o *LocatorOptions) error { _, err := l.InnerText(ctx, o); return err }, nil, nil},
		{"inner_html", func(l *PageLocator, o *LocatorOptions) error { _, err := l.InnerHTML(ctx, o); return err }, nil, nil},
		{"text_content", func(l *PageLocator, o *LocatorOptions) error { _, err := l.TextContent(ctx, o); return err }, nil, nil},
		{"scroll_to", func(l *PageLocator, o *LocatorOptions) error { return l.ScrollTo(ctx, NumericScrollPercent(50), o) }, map[string]any{"percent": float64(50)}, nil},
		{"centroid", func(l *PageLocator, o *LocatorOptions) error { _, err := l.Centroid(ctx, o); return err }, nil, nil},
		{"highlight", func(l *PageLocator, o *LocatorOptions) error {
			duration := 0
			return l.Highlight(ctx, &LocatorHighlightOptions{Timeout: o.Timeout, DurationMs: &duration})
		}, nil, map[string]any{"duration_ms": float64(0)}},
		{"send_click_event", func(l *PageLocator, o *LocatorOptions) error {
			bubbles := false
			return l.SendClickEvent(ctx, &LocatorSendClickEventOptions{Timeout: o.Timeout, Bubbles: &bubbles})
		}, nil, map[string]any{"bubbles": false}},
		{"type", func(l *PageLocator, o *LocatorOptions) error {
			delay := 25.0
			return l.Type(ctx, "hello", &LocatorTypeOptions{Timeout: o.Timeout, Delay: &delay})
		}, map[string]any{"text": "hello"}, map[string]any{"delay": float64(25)}},
		{"select_option", func(l *PageLocator, o *LocatorOptions) error {
			_, err := l.SelectOption(ctx, StringList{"a", "b"}, o)
			return err
		}, map[string]any{"values": []any{"a", "b"}}, nil},
		{"set_input_files", func(l *PageLocator, o *LocatorOptions) error {
			return l.SetInputFiles(ctx, []FileInput{FileData("hello.txt", "", []byte("hi"))}, o)
		}, map[string]any{"files": []any{map[string]any{"name": "hello.txt", "data": "aGk="}}}, nil},
	}
	covered := map[string]bool{}
	for _, test := range cases {
		covered["locator."+test.method] = true
		for _, timeout := range []*float64{nil, new(0.0), new(0.5), new(5000.0)} {
			name := "omitted"
			if timeout != nil {
				name = fmt.Sprint(*timeout)
			}
			t.Run(test.method+"/"+name, func(t *testing.T) {
				rpc := &recordingProtocolClient{}
				locator := (&PageLocator{rpc: rpc, descriptor: LocatorDescriptor{PageID: "page-1", Selector: "button"}}).First()
				if err := test.call(locator, &LocatorOptions{Timeout: timeout}); err != nil {
					t.Fatal(err)
				}
				if len(rpc.calls) != 1 || rpc.calls[0].method != "locator."+test.method {
					t.Fatalf("calls = %#v", rpc.calls)
				}
				encoded, err := marshalValidatedJSON(rpc.calls[0].params)
				if err != nil {
					t.Fatal(err)
				}
				var actual map[string]any
				if err := json.Unmarshal(encoded, &actual); err != nil {
					t.Fatal(err)
				}
				options := map[string]any{}
				for key, value := range test.options {
					options[key] = value
				}
				if timeout != nil {
					options["timeout"] = *timeout
				}
				expected := map[string]any{"page_id": "page-1", "selector": "button", "nth": float64(0), "options": options}
				for key, value := range test.fields {
					expected[key] = value
				}
				if !reflect.DeepEqual(actual, expected) {
					t.Fatalf("params = %#v, want %#v", actual, expected)
				}
				if locator.Descriptor().Nth == nil || *locator.Descriptor().Nth != 0 {
					t.Fatal("locator descriptor changed")
				}
			})
		}
	}
	data, err := os.ReadFile("../protocol/stagehand.v4.json")
	if err != nil {
		t.Fatal(err)
	}
	var protocol struct {
		Properties struct {
			Methods struct{ Properties map[string]json.RawMessage }
		}
	}
	if err := json.Unmarshal(data, &protocol); err != nil {
		t.Fatal(err)
	}
	for method := range protocol.Properties.Methods.Properties {
		if strings.HasPrefix(method, "locator.") && !covered[method] {
			t.Errorf("missing timeout case for %s", method)
		}
	}
}

func TestPageLocatorOptionalOptions(t *testing.T) {
	t.Parallel()
	rpc := &recordingProtocolClient{}
	locator := &PageLocator{rpc: rpc, descriptor: LocatorDescriptor{PageID: "page-1", Selector: "button"}}
	ctx := context.Background()
	for _, options := range [][]*LocatorOptions{nil, {nil}} {
		if _, err := locator.Count(ctx, options...); err != nil {
			t.Fatal(err)
		}
		encoded, err := marshalValidatedJSON(rpc.calls[len(rpc.calls)-1].params)
		if err != nil {
			t.Fatal(err)
		}
		assertRPCJSON(t, encoded, `{"page_id":"page-1","selector":"button"}`)
	}
	if _, err := locator.Count(ctx, &LocatorOptions{}, &LocatorOptions{}); err == nil {
		t.Fatal("accepted multiple options values")
	}
	if err := locator.SetInputFiles(ctx, nil, &LocatorOptions{}, &LocatorOptions{}); err == nil {
		t.Fatal("accepted multiple upload options values")
	}
	if len(rpc.calls) != 2 {
		t.Fatal("invalid options sent a request")
	}
	if err := locator.SetInputFiles(ctx, nil, &LocatorOptions{Timeout: new(0.0)}); err != nil {
		t.Fatal(err)
	}
	encoded, err := marshalValidatedJSON(rpc.calls[2].params)
	if err != nil {
		t.Fatal(err)
	}
	assertRPCJSON(t, encoded, `{"page_id":"page-1","selector":"button","files":[],"options":{"timeout":0}}`)
}
