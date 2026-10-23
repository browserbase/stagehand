package main

import (
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"testing/iotest"
)

func patchFixture(t *testing.T, version string) (string, string) {
	t.Helper()
	root := t.TempDir()
	sdkRoot := filepath.Join(root, "packages", "sdk-go")
	manifest := []byte(`{"name":"go-sdk","version":"` + version + `","private":true,"extra":{"keep":true}}`)
	identity, err := generateSDKVersionSource(manifest)
	if err != nil {
		t.Fatal(err)
	}
	files := map[string]string{
		"packages/sdk-go/package.json":                                     string(manifest),
		"packages/sdk-go/sdk_version.gen.go":                               string(identity),
		"packages/sdk-go/models.gen.go":                                    "existing models\n",
		"packages/sdk-go/protocol_version.gen.go":                          "existing protocol identity\n",
		"packages/sdk-go/go.mod":                                           "module github.com/browserbase/stagehand/packages/sdk-go/v4\n",
		"packages/sdk-go/internal/extensionassets/stagehand-extension.zip": "embedded runtime bytes",
		"packages/protocol/package.json":                                   `{"version":"3.0.0"}`,
		"packages/protocol/stagehand.v4.json":                              `{"protocol":"retained"}`,
		"packages/extension/package.json":                                  `{"version":"4.3.0"}`,
		"packages/extension/src/runtime.ts":                                "// A pending runtime security fix\n",
		"packages/extension/artifacts/stagehand-extension.zip":             "different, deliberately unrepacked build",
		"packages/sdk-ts/package.json":                                     `{"version":"4.3.0"}`,
		"packages/sdk-python/package.json":                                 `{"version":"4.3.0"}`,
		"packages/sdk-python/pyproject.toml":                               "[project]\nversion = \"4.3.0\"\n",
		"packages/sdk-python/uv.lock":                                      "existing Python lock\n",
		"pnpm-lock.yaml":                                                   "existing workspace lock\n",
		".changeset/pending.md":                                            "pending SDK feature release\n",
	}
	for name, contents := range files {
		file := filepath.Join(root, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(file, []byte(contents), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return root, sdkRoot
}

func patchSnapshot(t *testing.T, root string) map[string]string {
	t.Helper()
	files := make(map[string]string)
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		relative, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		files[filepath.ToSlash(relative)] = string(data)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return files
}

func TestPreparePatchChangesOnlyGoIdentity(t *testing.T) {
	t.Parallel()
	root, sdkRoot := patchFixture(t, "4.3.9")
	before := patchSnapshot(t, root)
	if err := preparePatch(sdkRoot, "4.3.10"); err != nil {
		t.Fatal(err)
	}
	after := patchSnapshot(t, root)
	var manifest map[string]any
	if err := json.Unmarshal([]byte(after["packages/sdk-go/package.json"]), &manifest); err != nil {
		t.Fatal(err)
	}
	want := map[string]any{"name": "go-sdk", "version": "4.3.10", "private": true, "extra": map[string]any{"keep": true}}
	if !reflect.DeepEqual(manifest, want) {
		t.Fatalf("manifest = %#v, want %#v", manifest, want)
	}
	if !strings.Contains(after["packages/sdk-go/sdk_version.gen.go"], `const stagehandSDKVersion = "4.3.10"`) {
		t.Fatal("generated SDK identity did not advance")
	}
	// Everything except the two release identity files must remain byte-identical,
	// even when an extension source fix and a different build are already present.
	before["packages/sdk-go/package.json"] = after["packages/sdk-go/package.json"]
	before["packages/sdk-go/sdk_version.gen.go"] = after["packages/sdk-go/sdk_version.gen.go"]
	if !reflect.DeepEqual(before, after) {
		t.Fatal("patch preparation changed protocol, runtime, or other SDK inputs")
	}
	if err := preparePatch(sdkRoot, "4.3.10"); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(after, patchSnapshot(t, root)) {
		t.Fatal("repeating patch preparation changed files")
	}
}

func TestPreparePatchRejectsInvalidTransitionsWithoutWriting(t *testing.T) {
	t.Parallel()
	for _, version := range []string{"", "v4.3.10", "4.3", "4.3.09", "4.3.10-beta.1", "4.3.10+build", "4.3.8", "4.2.10", "4.4.0", "5.3.10", "garbage"} {
		t.Run(version, func(t *testing.T) {
			root, sdkRoot := patchFixture(t, "4.3.9")
			before := patchSnapshot(t, root)
			if err := preparePatch(sdkRoot, version); err == nil {
				t.Fatal("accepted invalid patch version")
			}
			if !reflect.DeepEqual(before, patchSnapshot(t, root)) {
				t.Fatal("invalid patch changed files")
			}
		})
	}
}

func TestPreparePatchRequiresStableV4StartingVersion(t *testing.T) {
	t.Parallel()
	for _, version := range []string{"4.3.9-beta.1", "4.3.9+build", "3.3.9", "5.3.9"} {
		root, sdkRoot := patchFixture(t, version)
		before := patchSnapshot(t, root)
		if err := preparePatch(sdkRoot, "4.3.10"); err == nil {
			t.Fatalf("accepted starting version %s", version)
		}
		if !reflect.DeepEqual(before, patchSnapshot(t, root)) {
			t.Fatal("invalid starting version changed files")
		}
	}
}

func TestPreparePatchRejectsStaleSDKIdentityWithoutWriting(t *testing.T) {
	t.Parallel()
	root, sdkRoot := patchFixture(t, "4.3.9")
	if err := os.WriteFile(filepath.Join(sdkRoot, sdkVersionFile), []byte("stale identity\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	before := patchSnapshot(t, root)
	if err := preparePatch(sdkRoot, "4.3.10"); err == nil || !strings.Contains(err.Error(), "stale") {
		t.Fatalf("expected stale identity error, got %v", err)
	}
	if !reflect.DeepEqual(before, patchSnapshot(t, root)) {
		t.Fatal("stale identity rejection changed files")
	}
}

func TestWritePatchFilePreservesOriginalAfterPartialWrite(t *testing.T) {
	t.Parallel()
	for _, name := range []string{"package.json", sdkVersionFile} {
		t.Run(name, func(t *testing.T) {
			root, sdkRoot := patchFixture(t, "4.3.9")
			before := patchSnapshot(t, root)
			writeErr := errors.New("write interrupted")
			contents := io.MultiReader(strings.NewReader("partial new contents"), iotest.ErrReader(writeErr))
			if err := writePatchFile(filepath.Join(sdkRoot, name), contents); !errors.Is(err, writeErr) {
				t.Fatalf("expected write error, got %v", err)
			}
			if !reflect.DeepEqual(before, patchSnapshot(t, root)) {
				t.Fatal("partial write changed an original file or left a temporary file behind")
			}
		})
	}
}
