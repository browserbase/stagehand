package main

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

func TestSyncArchiveRefreshesAndChecksCanonicalArtifact(t *testing.T) {
	t.Parallel()

	directory := t.TempDir()
	sourcePath := filepath.Join(directory, "built.zip")
	targetPath := filepath.Join(directory, "embedded.zip")
	metadataPath := filepath.Join(directory, "metadata.json")
	packagePath := filepath.Join(directory, "package.json")
	archive := testArchive(t, "1.2.3")
	if err := os.WriteFile(sourcePath, archive, 0o644); err != nil {
		t.Fatalf("write source archive: %v", err)
	}
	if err := os.WriteFile(packagePath, []byte(`{"version":"1.2.3-beta.1"}`), 0o644); err != nil {
		t.Fatalf("write package.json: %v", err)
	}
	writeMetadata(t, metadataPath, false, archive)

	if err := syncArchive(sourcePath, metadataPath, targetPath, packagePath, false); err != nil {
		t.Fatalf("syncArchive() error = %v", err)
	}
	if err := syncArchive(sourcePath, metadataPath, targetPath, packagePath, true); err != nil {
		t.Fatalf("syncArchive(check) error = %v", err)
	}
	if err := os.WriteFile(targetPath, []byte("stale"), 0o644); err != nil {
		t.Fatalf("write stale archive: %v", err)
	}
	if err := syncArchive(sourcePath, metadataPath, targetPath, packagePath, true); err == nil {
		t.Fatal("syncArchive(check) accepted a stale archive")
	}
}

func TestValidateArchiveMetadataRejectsPrivateArtifact(t *testing.T) {
	t.Parallel()

	directory := t.TempDir()
	metadataPath := filepath.Join(directory, "metadata.json")
	archive := testArchive(t, "1.0.0")
	writeMetadata(t, metadataPath, true, archive)

	if err := validateArchiveMetadata(archive, metadataPath); err == nil {
		t.Fatal("validateArchiveMetadata() accepted a private artifact")
	}
}

func TestValidateArchiveMetadataRejectsDigestMismatch(t *testing.T) {
	t.Parallel()

	directory := t.TempDir()
	metadataPath := filepath.Join(directory, "metadata.json")
	archive := testArchive(t, "1.0.0")
	writeMetadata(t, metadataPath, false, []byte("different archive"))

	if err := validateArchiveMetadata(archive, metadataPath); err == nil {
		t.Fatal("validateArchiveMetadata() accepted a mismatched digest")
	}
}

func TestValidateArchiveVersionRejectsDrift(t *testing.T) {
	t.Parallel()

	packagePath := filepath.Join(t.TempDir(), "package.json")
	if err := os.WriteFile(packagePath, []byte(`{"version":"2.0.0"}`), 0o644); err != nil {
		t.Fatalf("write package.json: %v", err)
	}
	if err := validateArchiveVersion(testArchive(t, "1.0.0"), packagePath); err == nil {
		t.Fatal("validateArchiveVersion() accepted a mismatched manifest")
	}
}

func testArchive(t *testing.T, version string) []byte {
	t.Helper()

	var archive bytes.Buffer
	writer := zip.NewWriter(&archive)
	manifest, err := writer.Create("manifest.json")
	if err != nil {
		t.Fatalf("create manifest entry: %v", err)
	}
	if _, err := manifest.Write([]byte(`{"version":"` + version + `"}`)); err != nil {
		t.Fatalf("write manifest entry: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close archive: %v", err)
	}
	return archive.Bytes()
}

func writeMetadata(t *testing.T, metadataPath string, private bool, archive []byte) {
	t.Helper()

	contents := fmt.Sprintf(
		`{"residentGatewayConfigured":%t,"sha256":"%x"}`,
		private,
		sha256.Sum256(archive),
	)
	if err := os.WriteFile(metadataPath, []byte(contents), 0o644); err != nil {
		t.Fatalf("write metadata: %v", err)
	}
}
