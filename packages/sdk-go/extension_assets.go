package stagehand

import "github.com/browserbase/stagehand/packages/sdk-go/v4/internal/extensionassets"

// ExtensionArchive returns a copy of the ZIP archive of the extension bundled
// with this SDK. Save or upload the bytes directly, or extract them to a directory
// for Chrome's Load unpacked option. No browser session is required.
func ExtensionArchive() []byte {
	return extensionassets.Archive()
}
