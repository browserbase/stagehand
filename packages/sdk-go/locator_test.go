package stagehand

import (
	"context"
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
