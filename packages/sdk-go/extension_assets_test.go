package stagehand_test

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"io"
	"testing"

	stagehand "github.com/browserbase/stagehand/packages/sdk-go/v4"
)

func TestExtensionArchiveContainsManifestAndWorker(t *testing.T) {
	t.Parallel()
	archive := stagehand.ExtensionArchive()
	reader, err := zip.NewReader(bytes.NewReader(archive), int64(len(archive)))
	if err != nil {
		t.Fatalf("open extension ZIP: %v", err)
	}
	file, err := reader.Open("manifest.json")
	if err != nil {
		t.Fatalf("open root manifest: %v", err)
	}
	defer file.Close()
	var manifest struct {
		ManifestVersion int    `json:"manifest_version"`
		Name            string `json:"name"`
		Version         string `json:"version"`
		Background      struct {
			ServiceWorker string `json:"service_worker"`
		} `json:"background"`
	}
	if err := json.NewDecoder(file).Decode(&manifest); err != nil {
		t.Fatalf("decode manifest: %v", err)
	}
	if manifest.ManifestVersion != 3 || manifest.Name != "Stagehand Runtime" || manifest.Version == "" {
		t.Fatalf("unexpected manifest: %+v", manifest)
	}
	worker, err := reader.Open(manifest.Background.ServiceWorker)
	if err != nil {
		t.Fatalf("open manifest service worker: %v", err)
	}
	defer worker.Close()
	contents, err := io.ReadAll(worker)
	if err != nil || len(contents) == 0 {
		t.Fatalf("read service worker: length=%d, err=%v", len(contents), err)
	}
}

func TestExtensionArchiveReturnsIndependentCopies(t *testing.T) {
	t.Parallel()
	original := bytes.Clone(stagehand.ExtensionArchive())
	modified := stagehand.ExtensionArchive()
	clear(modified)
	if !bytes.Equal(original, stagehand.ExtensionArchive()) {
		t.Fatal("mutating a returned archive corrupted the bundled extension")
	}
}
