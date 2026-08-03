package stagehand

import (
	"context"
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
)

// FileInput describes either a local file path or an in-memory file payload.
// Use FilePath or FileData to construct one.
type FileInput struct {
	Path         string
	Name         string
	MIMEType     string
	Buffer       []byte
	LastModified *int
}

// FilePath creates an upload from a path on the SDK caller's filesystem.
func FilePath(path string) FileInput {
	return FileInput{Path: path}
}

// FileData creates an in-memory upload payload.
func FileData(name string, mimeType string, buffer []byte) FileInput {
	return FileInput{Name: name, MIMEType: mimeType, Buffer: append([]byte(nil), buffer...)}
}

// PageLocator is the client wrapper named Locator in the TypeScript and Python
// SDKs. The Go protocol already exports a different generated Locator value.
type PageLocator struct {
	rpc        protocolClient
	descriptor LocatorDescriptor
}

// Descriptor returns the generated wire descriptor.
func (l *PageLocator) Descriptor() LocatorDescriptor {
	return l.descriptor
}

// Click clicks the matching element.
func (l *PageLocator) Click(ctx context.Context, options *LocatorClickOptions) error {
	params := LocatorClickParams{
		PageID: l.descriptor.PageID, Selector: l.descriptor.Selector, Nth: l.descriptor.Nth,
		Options: options,
	}
	var result LocatorClickResult
	return l.rpc.call(ctx, "locator.click", params, &result)
}

// Hover hovers the matching element.
func (l *PageLocator) Hover(ctx context.Context) error {
	params := l.descriptor
	var result LocatorHoverResult
	return l.rpc.call(ctx, "locator.hover", params, &result)
}

// Fill replaces the matching input's value.
func (l *PageLocator) Fill(ctx context.Context, value string) error {
	params := LocatorFillParams{
		PageID: l.descriptor.PageID, Selector: l.descriptor.Selector, Nth: l.descriptor.Nth,
		Value: value,
	}
	var result LocatorFillResult
	return l.rpc.call(ctx, "locator.fill", params, &result)
}

// Count returns the number of matching elements.
func (l *PageLocator) Count(ctx context.Context) (int, error) {
	params := l.descriptor
	var result LocatorCountResult
	if err := l.rpc.call(ctx, "locator.count", params, &result); err != nil {
		return 0, err
	}
	return int(result), nil
}

// IsChecked reports whether the matching control is checked.
func (l *PageLocator) IsChecked(ctx context.Context) (bool, error) {
	params := l.descriptor
	var result LocatorIsCheckedResult
	if err := l.rpc.call(ctx, "locator.is_checked", params, &result); err != nil {
		return false, err
	}
	return bool(result), nil
}

// InputValue returns the matching input's value.
func (l *PageLocator) InputValue(ctx context.Context) (string, error) {
	params := l.descriptor
	var result LocatorInputValueResult
	if err := l.rpc.call(ctx, "locator.input_value", params, &result); err != nil {
		return "", err
	}
	return string(result), nil
}

// IsVisible reports whether the matching element is visible.
func (l *PageLocator) IsVisible(ctx context.Context) (bool, error) {
	params := l.descriptor
	var result LocatorIsVisibleResult
	if err := l.rpc.call(ctx, "locator.is_visible", params, &result); err != nil {
		return false, err
	}
	return bool(result), nil
}

// InnerText returns the matching element's rendered text.
func (l *PageLocator) InnerText(ctx context.Context) (string, error) {
	params := l.descriptor
	var result LocatorInnerTextResult
	if err := l.rpc.call(ctx, "locator.inner_text", params, &result); err != nil {
		return "", err
	}
	return string(result), nil
}

// InnerHTML returns the matching element's HTML.
func (l *PageLocator) InnerHTML(ctx context.Context) (string, error) {
	params := l.descriptor
	var result LocatorInnerHTMLResult
	if err := l.rpc.call(ctx, "locator.inner_html", params, &result); err != nil {
		return "", err
	}
	return string(result), nil
}

// TextContent returns the matching element's text content.
func (l *PageLocator) TextContent(ctx context.Context) (string, error) {
	params := l.descriptor
	var result LocatorTextContentResult
	if err := l.rpc.call(ctx, "locator.text_content", params, &result); err != nil {
		return "", err
	}
	return string(result), nil
}

// ScrollTo scrolls the matching element to a generated percentage value.
func (l *PageLocator) ScrollTo(ctx context.Context, percent ScrollPercent) error {
	params := LocatorScrollToParams{
		PageID: l.descriptor.PageID, Selector: l.descriptor.Selector, Nth: l.descriptor.Nth,
		Percent: percent,
	}
	var result LocatorScrollToResult
	return l.rpc.call(ctx, "locator.scroll_to", params, &result)
}

// Centroid returns the matching element's center coordinates.
func (l *PageLocator) Centroid(ctx context.Context) (LocatorCentroidResult, error) {
	params := l.descriptor
	var result LocatorCentroidResult
	err := l.rpc.call(ctx, "locator.centroid", params, &result)
	return result, err
}

// Highlight highlights the matching element.
func (l *PageLocator) Highlight(ctx context.Context, options *LocatorHighlightOptions) error {
	params := LocatorHighlightParams{
		PageID: l.descriptor.PageID, Selector: l.descriptor.Selector, Nth: l.descriptor.Nth,
		Options: options,
	}
	var result LocatorHighlightResult
	return l.rpc.call(ctx, "locator.highlight", params, &result)
}

// SendClickEvent sends a click event to the matching element.
func (l *PageLocator) SendClickEvent(
	ctx context.Context,
	options *LocatorSendClickEventOptions,
) error {
	params := LocatorSendClickEventParams{
		PageID: l.descriptor.PageID, Selector: l.descriptor.Selector, Nth: l.descriptor.Nth,
		Options: options,
	}
	var result LocatorSendClickEventResult
	return l.rpc.call(ctx, "locator.send_click_event", params, &result)
}

// Type enters text into the matching element.
func (l *PageLocator) Type(ctx context.Context, text string, options *LocatorTypeOptions) error {
	params := LocatorTypeParams{
		PageID: l.descriptor.PageID, Selector: l.descriptor.Selector, Nth: l.descriptor.Nth,
		Text: text, Options: options,
	}
	var result LocatorTypeResult
	return l.rpc.call(ctx, "locator.type", params, &result)
}

// SelectOption selects values in the matching element.
func (l *PageLocator) SelectOption(ctx context.Context, values StringList) ([]string, error) {
	params := LocatorSelectOptionParams{
		PageID: l.descriptor.PageID, Selector: l.descriptor.Selector, Nth: l.descriptor.Nth,
		Values: values,
	}
	var result LocatorSelectOptionResult
	if err := l.rpc.call(ctx, "locator.select_option", params, &result); err != nil {
		return nil, err
	}
	return []string(result), nil
}

// SetInputFiles sets files on the matching <input type="file"> element. Calling
// it without files clears the current selection.
func (l *PageLocator) SetInputFiles(ctx context.Context, files ...FileInput) error {
	payloads := make([]InputFilePayload, 0, len(files))
	for _, file := range files {
		payload, err := normalizeFileInput(file)
		if err != nil {
			return err
		}
		payloads = append(payloads, payload)
	}

	params := LocatorSetInputFilesParams{
		PageID: l.descriptor.PageID, Selector: l.descriptor.Selector, Nth: l.descriptor.Nth,
		Files: payloads,
	}
	var result LocatorSetInputFilesResult
	return l.rpc.call(ctx, "locator.set_input_files", params, &result)
}

func normalizeFileInput(file FileInput) (InputFilePayload, error) {
	if file.Path != "" {
		if file.Name != "" || file.MIMEType != "" || file.Buffer != nil || file.LastModified != nil {
			return InputFilePayload{}, fmt.Errorf("set input files: path and payload fields cannot be combined")
		}
		absolutePath, err := filepath.Abs(file.Path)
		if err != nil {
			return InputFilePayload{}, fmt.Errorf("set input files: resolve %q: %w", file.Path, err)
		}
		info, err := os.Stat(absolutePath)
		if err != nil {
			return InputFilePayload{}, fmt.Errorf("set input files: stat %q: %w", absolutePath, err)
		}
		if !info.Mode().IsRegular() {
			return InputFilePayload{}, fmt.Errorf("set input files: expected a file at %q", absolutePath)
		}
		data, err := os.ReadFile(absolutePath)
		if err != nil {
			return InputFilePayload{}, fmt.Errorf("set input files: read %q: %w", absolutePath, err)
		}
		lastModified := int(info.ModTime().UnixMilli())
		return InputFilePayload{
			Name: filepath.Base(absolutePath), Data: base64.StdEncoding.EncodeToString(data),
			LastModified: &lastModified,
		}, nil
	}

	if file.Name == "" {
		return InputFilePayload{}, fmt.Errorf("set input files: payload name cannot be empty")
	}
	payload := InputFilePayload{
		Name: file.Name, Data: base64.StdEncoding.EncodeToString(file.Buffer),
		LastModified: file.LastModified,
	}
	if file.MIMEType != "" {
		payload.MIMEType = &file.MIMEType
	}
	return payload, nil
}

// First returns a locator restricted to the first match.
func (l *PageLocator) First() *PageLocator {
	index := 0
	descriptor := l.descriptor
	descriptor.Nth = &index
	return &PageLocator{rpc: l.rpc, descriptor: descriptor}
}

// Nth returns a locator restricted to one zero-based match. It returns an
// error when index is negative.
func (l *PageLocator) Nth(index int) (*PageLocator, error) {
	if index < 0 {
		return nil, fmt.Errorf("stagehand locator index must be non-negative: %d", index)
	}
	descriptor := l.descriptor
	descriptor.Nth = &index
	return &PageLocator{rpc: l.rpc, descriptor: descriptor}, nil
}
