package stagehand

import "context"

// ClipboardOptions optionally scopes a clipboard operation to one page.
type ClipboardOptions struct {
	Page *Page
}

// ClipboardPasteOptions optionally scopes paste and selects its shortcut.
type ClipboardPasteOptions struct {
	Page     *Page
	Shortcut *ContextClipboardPasteParamsShortcut
}

// BrowserClipboard exposes context clipboard operations.
type BrowserClipboard struct {
	rpc protocolClient
}

// ReadText returns the current clipboard text.
func (c *BrowserClipboard) ReadText(ctx context.Context, options *ClipboardOptions) (string, error) {
	params := clipboardTarget(options)
	var result ContextClipboardReadTextResult
	if err := c.rpc.call(ctx, "context.clipboard_read_text", params, &result); err != nil {
		return "", err
	}
	return string(result), nil
}

// WriteText replaces the current clipboard text.
func (c *BrowserClipboard) WriteText(ctx context.Context, text string, options *ClipboardOptions) error {
	params := ContextClipboardWriteTextParams{PageID: pageID(options), Text: text}
	var result ContextVoidResult
	return c.rpc.call(ctx, "context.clipboard_write_text", params, &result)
}

// Clear clears the clipboard.
func (c *BrowserClipboard) Clear(ctx context.Context, options *ClipboardOptions) error {
	params := clipboardTarget(options)
	var result ContextVoidResult
	return c.rpc.call(ctx, "context.clipboard_clear", params, &result)
}

// Paste pastes the clipboard into the active element.
func (c *BrowserClipboard) Paste(ctx context.Context, options *ClipboardPasteOptions) error {
	params := ContextClipboardPasteParams{}
	if options != nil {
		params.PageID = pageID(&ClipboardOptions{Page: options.Page})
		params.Shortcut = options.Shortcut
	}
	var result ContextVoidResult
	return c.rpc.call(ctx, "context.clipboard_paste", params, &result)
}

// Copy copies the current selection.
func (c *BrowserClipboard) Copy(ctx context.Context, options *ClipboardOptions) error {
	params := clipboardTarget(options)
	var result ContextVoidResult
	return c.rpc.call(ctx, "context.clipboard_copy", params, &result)
}

// Cut cuts the current selection.
func (c *BrowserClipboard) Cut(ctx context.Context, options *ClipboardOptions) error {
	params := clipboardTarget(options)
	var result ContextVoidResult
	return c.rpc.call(ctx, "context.clipboard_cut", params, &result)
}

func clipboardTarget(options *ClipboardOptions) ContextClipboardTarget {
	return ContextClipboardTarget{PageID: pageID(options)}
}

func pageID(options *ClipboardOptions) *string {
	if options == nil || options.Page == nil {
		return nil
	}
	pageID := options.Page.PageID()
	return &pageID
}
