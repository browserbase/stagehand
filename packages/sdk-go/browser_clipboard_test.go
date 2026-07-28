package stagehand

import (
	"context"
	"testing"
)

func TestBrowserClipboardMapsScopedAndUnscopedCalls(t *testing.T) {
	t.Parallel()

	shortcut := ContextClipboardPasteParamsShortcutControlOrMetaV
	rpc := &recordingProtocolClient{responses: map[string]any{
		"context.clipboard_read_text": ContextClipboardReadTextResult("copied"),
	}}
	clipboard := &BrowserClipboard{rpc: rpc}
	page := &Page{rpc: rpc, ref: PageRef{PageID: "page-1"}}

	text, err := clipboard.ReadText(context.Background(), &ClipboardOptions{Page: page})
	if err != nil {
		t.Fatalf("ReadText() error = %v", err)
	}
	if text != "copied" {
		t.Fatalf("ReadText() = %q, want copied", text)
	}
	if err := clipboard.Clear(context.Background(), nil); err != nil {
		t.Fatalf("Clear() error = %v", err)
	}
	if err := clipboard.Paste(context.Background(), &ClipboardPasteOptions{
		Page:     page,
		Shortcut: &shortcut,
	}); err != nil {
		t.Fatalf("Paste() error = %v", err)
	}

	readParams, ok := rpc.calls[0].params.(ContextClipboardTarget)
	if !ok || readParams.PageID == nil || *readParams.PageID != "page-1" {
		t.Fatalf("ReadText() params = %#v", rpc.calls[0].params)
	}
	clearParams, ok := rpc.calls[1].params.(ContextClipboardTarget)
	if !ok || clearParams.PageID != nil {
		t.Fatalf("Clear() params = %#v", rpc.calls[1].params)
	}
	pasteParams, ok := rpc.calls[2].params.(ContextClipboardPasteParams)
	if !ok ||
		pasteParams.PageID == nil ||
		*pasteParams.PageID != "page-1" ||
		pasteParams.Shortcut == nil ||
		*pasteParams.Shortcut != shortcut {
		t.Fatalf("Paste() params = %#v", rpc.calls[2].params)
	}
}
