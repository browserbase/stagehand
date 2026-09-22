package stagehand

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
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

	if err := locator.SetInputFiles(context.Background(), FilePath(filePath)); err != nil {
		t.Fatalf("SetInputFiles(path) error = %v", err)
	}
	lastModified := int64(42)
	payload := FileData("bytes.bin", "application/octet-stream", []byte{0, 127, 255})
	payload.LastModified = &lastModified
	if err := locator.SetInputFiles(
		context.Background(),
		payload,
		FileData("message.txt", "", []byte("hello")),
	); err != nil {
		t.Fatalf("SetInputFiles(payloads) error = %v", err)
	}
	if err := locator.SetInputFiles(context.Background()); err != nil {
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
	if err := locator.SetInputFiles(context.Background(), FilePath(historicalPath)); err != nil {
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
	if err := locator.SetInputFiles(context.Background(), FilePath(oversizedPath)); err == nil ||
		err.Error() != "set input files: file is larger than the 50 MiB upload limit" {
		t.Fatalf("SetInputFiles(oversized path) error = %v", err)
	}
	negativeLastModified := int64(-1)
	invalidPayload := FileData("historical.txt", "text/plain", []byte("old"))
	invalidPayload.LastModified = &negativeLastModified
	if err := locator.SetInputFiles(context.Background(), invalidPayload); err == nil ||
		err.Error() != "set input files: last modified must be non-negative" {
		t.Fatalf("SetInputFiles(negative last modified) error = %v", err)
	}
}

func TestAllLocatorMethodsForwardTimeout(t *testing.T) {
	for _, timeout := range []*int{nil, locatorTestPtr(0), locatorTestPtr(15000)} {
		var options *LocatorOptions
		if timeout != nil {
			options = &LocatorOptions{Timeout: timeout}
		}
		rpc := &recordingProtocolClient{}
		locator := &PageLocator{rpc: rpc, descriptor: LocatorDescriptor{PageID: "page", Selector: "iframe >> button", Nth: locatorTestPtr(2)}}
		ctx := context.Background()
		calls := []func() error{
			func() error {
				return locator.Click(ctx, &LocatorClickOptions{Timeout: timeout, ClickCount: locatorTestPtr(2)})
			},
			func() error { return locator.Hover(ctx, options) },
			func() error { return locator.Fill(ctx, "hello", options) },
			func() error {
				return locator.Type(ctx, "hello", &LocatorTypeOptions{Timeout: timeout, Delay: locatorTestPtr(float64(25))})
			},
			func() error { _, err := locator.SelectOption(ctx, StringList{"one"}, options); return err },
			func() error { return locator.SetInputFilesWithOptions(ctx, options) },
			func() error { return locator.ScrollTo(ctx, NumericScrollPercent(50), options) },
			func() error {
				return locator.SendClickEvent(ctx, &LocatorSendClickEventOptions{Timeout: timeout, Bubbles: locatorTestPtr(false)})
			},
			func() error { _, err := locator.InnerText(ctx, options); return err },
			func() error { _, err := locator.InnerHTML(ctx, options); return err },
			func() error { _, err := locator.TextContent(ctx, options); return err },
			func() error { _, err := locator.InputValue(ctx, options); return err },
			func() error { _, err := locator.IsChecked(ctx, options); return err },
			func() error { _, err := locator.Centroid(ctx, options); return err },
			func() error { _, err := locator.Count(ctx, options); return err },
			func() error { _, err := locator.IsVisible(ctx, options); return err },
			func() error {
				return locator.Highlight(ctx, &LocatorHighlightOptions{Timeout: timeout, DurationMs: locatorTestPtr(100)})
			},
		}
		for _, call := range calls {
			if err := call(); err != nil {
				t.Fatal(err)
			}
		}
		for _, call := range rpc.calls {
			wire, err := json.Marshal(call.params)
			if err != nil {
				t.Fatal(err)
			}
			var params struct {
				PageID   string `json:"page_id"`
				Selector string `json:"selector"`
				Nth      int    `json:"nth"`
				Options  struct {
					Timeout *int `json:"timeout"`
				} `json:"options"`
			}
			if err := json.Unmarshal(wire, &params); err != nil {
				t.Fatal(err)
			}
			if params.PageID != "page" || params.Selector != "iframe >> button" || params.Nth != 2 {
				t.Fatalf("descriptor lost: %s", wire)
			}
			if timeout == nil {
				if params.Options.Timeout != nil {
					t.Fatalf("omitted timeout filled: %s", wire)
				}
			} else if params.Options.Timeout == nil || *params.Options.Timeout != *timeout {
				t.Fatalf("timeout lost: %s", wire)
			}
			duration, bounded := rpcResponseTimeout(call.method, wire)
			expected := 15 * time.Second
			if timeout != nil {
				expected = time.Duration(*timeout)*time.Millisecond + 10*time.Second
			}
			if timeout != nil && *timeout == 0 {
				if bounded {
					t.Fatal("zero timeout must be unbounded")
				}
			} else if !bounded || duration != expected {
				t.Fatalf("response timeout = %v, %v; want %v", duration, bounded, expected)
			}
		}
	}
}

func locatorTestPtr[T any](value T) *T { return &value }

// The transport fallback must track the schema-owned server default.
func TestLocatorTransportDefaultMatchesProtocol(t *testing.T) {
	data, err := os.ReadFile("../protocol/stagehand.v4.json")
	if err != nil {
		t.Fatal(err)
	}
	var schema struct {
		Defs struct {
			LocatorOptions struct {
				Properties struct {
					Timeout struct {
						Default float64 `json:"default"`
					} `json:"timeout"`
				} `json:"properties"`
			} `json:"LocatorOptions"`
		} `json:"$defs"`
	}
	if err := json.Unmarshal(data, &schema); err != nil {
		t.Fatal(err)
	}
	timeout, bounded := rpcResponseTimeout("locator.click", json.RawMessage(`{}`))
	expected := rpcResponseGrace + time.Duration(schema.Defs.LocatorOptions.Properties.Timeout.Default)*time.Millisecond
	if !bounded || timeout != expected {
		t.Fatalf("response timeout = %v; schema default plus grace = %v", timeout, expected)
	}
}
