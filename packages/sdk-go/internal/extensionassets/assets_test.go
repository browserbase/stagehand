package extensionassets

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"testing"
)

func TestArchiveContainsLoadableStagehandExtension(t *testing.T) {
	t.Parallel()

	archive := Archive()
	reader, err := zip.NewReader(bytes.NewReader(archive), int64(len(archive)))
	if err != nil {
		t.Fatalf("open Archive(): %v", err)
	}

	var names []string
	var manifest struct {
		ManifestVersion int    `json:"manifest_version"`
		Name            string `json:"name"`
		Version         string `json:"version"`
	}
	for _, file := range reader.File {
		names = append(names, file.Name)
		if file.Name != "manifest.json" {
			continue
		}
		source, err := file.Open()
		if err != nil {
			t.Fatalf("open manifest: %v", err)
		}
		if err := json.NewDecoder(source).Decode(&manifest); err != nil {
			_ = source.Close()
			t.Fatalf("decode manifest: %v", err)
		}
		if err := source.Close(); err != nil {
			t.Fatalf("close manifest: %v", err)
		}
	}
	slices.Sort(names)
	wantNames := []string{
		"blank.html",
		"content-script.js",
		"manifest.json",
		"offscreen/service-worker-heartbeat.html",
		"offscreen/service-worker-heartbeat.js",
		"service-worker.js",
		"wake-service-worker.html",
		"wake-service-worker.js",
	}
	if !reflect.DeepEqual(names, wantNames) {
		t.Fatalf("archive paths = %#v, want %#v", names, wantNames)
	}
	if manifest.ManifestVersion != 3 ||
		manifest.Name != "Stagehand Runtime" ||
		manifest.Version == "" {
		t.Fatalf("manifest = %#v", manifest)
	}
}

func TestArchiveReturnsAnIndependentCopy(t *testing.T) {
	t.Parallel()

	first := Archive()
	first[0] ^= 0xff
	if bytes.Equal(first, Archive()) {
		t.Fatal("Archive() returned mutable embedded storage")
	}
}

func TestMaterializeMatchesArchiveAndCleansUp(t *testing.T) {
	t.Parallel()

	parentDirectory := filepath.Join(t.TempDir(), "parent with spaces")
	if err := os.Mkdir(parentDirectory, 0o755); err != nil {
		t.Fatalf("create parent directory: %v", err)
	}
	directory, cleanup, err := materialize(Archive(), parentDirectory)
	if err != nil {
		t.Fatalf("materialize() error = %v", err)
	}

	reader, err := zip.NewReader(
		bytes.NewReader(stagehandExtensionArchive),
		int64(len(stagehandExtensionArchive)),
	)
	if err != nil {
		t.Fatalf("open embedded archive: %v", err)
	}
	for _, file := range reader.File {
		if file.FileInfo().IsDir() {
			continue
		}
		source, err := file.Open()
		if err != nil {
			t.Fatalf("open archive file %q: %v", file.Name, err)
		}
		want, err := io.ReadAll(source)
		if err != nil {
			_ = source.Close()
			t.Fatalf("read archive file %q: %v", file.Name, err)
		}
		if err := source.Close(); err != nil {
			t.Fatalf("close archive file %q: %v", file.Name, err)
		}
		got, err := os.ReadFile(filepath.Join(directory, filepath.FromSlash(file.Name)))
		if err != nil {
			t.Fatalf("read extracted file %q: %v", file.Name, err)
		}
		if !bytes.Equal(got, want) {
			t.Errorf("extracted file %q does not match archive", file.Name)
		}
	}

	if err := cleanup(); err != nil {
		t.Fatalf("cleanup() error = %v", err)
	}
	if err := cleanup(); err != nil {
		t.Fatalf("second cleanup() error = %v", err)
	}
	if _, err := os.Stat(directory); !os.IsNotExist(err) {
		t.Fatalf("materialized directory still exists: %v", err)
	}
}

func TestMaterializeRejectsUnsafePaths(t *testing.T) {
	t.Parallel()

	var archive bytes.Buffer
	writer := zip.NewWriter(&archive)
	file, err := writer.Create("../outside")
	if err != nil {
		t.Fatalf("create unsafe ZIP entry: %v", err)
	}
	if _, err := file.Write([]byte("unsafe")); err != nil {
		t.Fatalf("write unsafe ZIP entry: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close unsafe ZIP: %v", err)
	}

	parentDirectory := t.TempDir()
	if _, _, err := materialize(archive.Bytes(), parentDirectory); err == nil {
		t.Fatal("materialize() accepted an unsafe path")
	}
	if _, err := os.Stat(filepath.Join(parentDirectory, "outside")); !os.IsNotExist(err) {
		t.Fatalf("unsafe file escaped the materialization directory: %v", err)
	}
}
