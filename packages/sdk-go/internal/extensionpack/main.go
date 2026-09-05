// Command extensionpack synchronizes the deterministic extension build into the
// Go module, where go:embed can include it for consumers.
package main

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

func main() {
	check := flag.Bool("check", false, "fail when the embedded extension differs")
	flag.Parse()

	if err := run(*check); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(check bool) error {
	_, sourceFile, _, ok := runtime.Caller(0)
	if !ok {
		return errors.New("locate Go extension packaging source")
	}
	sdkRoot := filepath.Clean(filepath.Join(filepath.Dir(sourceFile), "..", ".."))
	return syncArchive(
		filepath.Join(
			sdkRoot,
			"..",
			"extension",
			"artifacts",
			"stagehand-extension.zip",
		),
		filepath.Join(
			sdkRoot,
			"internal",
			"extensionassets",
			"stagehand-extension.zip",
		),
		filepath.Join(sdkRoot, "..", "extension", "package.json"),
		check,
	)
}

func syncArchive(sourcePath, targetPath, packagePath string, check bool) error {
	source, err := os.ReadFile(sourcePath)
	if err != nil {
		return fmt.Errorf(
			"read built Stagehand extension (run the root `just build` command): %w",
			err,
		)
	}
	if err := validateArchiveVersion(source, packagePath); err != nil {
		return err
	}

	current, err := os.ReadFile(targetPath)
	if check {
		switch {
		case err != nil:
			return fmt.Errorf(
				"read embedded Stagehand extension (run `just generate`): %w",
				err,
			)
		case !bytes.Equal(current, source):
			return fmt.Errorf(
				"embedded Stagehand extension is stale (built sha256 %x, embedded sha256 %x); run `just generate`",
				sha256.Sum256(source),
				sha256.Sum256(current),
			)
		default:
			return nil
		}
	}
	if err == nil && bytes.Equal(current, source) {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(targetPath), 0o755); err != nil {
		return fmt.Errorf("create Go extension asset directory: %w", err)
	}

	temporary, err := os.CreateTemp(filepath.Dir(targetPath), ".stagehand-extension-*.tmp")
	if err != nil {
		return fmt.Errorf("create temporary Go extension asset: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o644); err != nil {
		_ = temporary.Close()
		return fmt.Errorf("set Go extension asset permissions: %w", err)
	}
	if _, err := temporary.Write(source); err != nil {
		_ = temporary.Close()
		return fmt.Errorf("write Go extension asset: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close Go extension asset: %w", err)
	}
	if err := os.Rename(temporaryPath, targetPath); err != nil {
		return fmt.Errorf("replace Go extension asset: %w", err)
	}
	return nil
}

func validateArchiveVersion(archive []byte, packagePath string) error {
	var extensionPackage struct {
		Version string `json:"version"`
	}
	packageData, err := os.ReadFile(packagePath)
	if err != nil {
		return fmt.Errorf("read extension package version: %w", err)
	}
	if err := json.Unmarshal(packageData, &extensionPackage); err != nil {
		return fmt.Errorf("decode extension package version: %w", err)
	}
	expectedVersion := extensionPackage.Version
	if separator := strings.IndexAny(expectedVersion, "+-"); separator >= 0 {
		expectedVersion = expectedVersion[:separator]
	}
	if expectedVersion == "" {
		return errors.New("extension package version is empty")
	}

	reader, err := zip.NewReader(bytes.NewReader(archive), int64(len(archive)))
	if err != nil {
		return fmt.Errorf("open built Stagehand extension: %w", err)
	}
	for _, file := range reader.File {
		if file.Name != "manifest.json" {
			continue
		}
		source, err := file.Open()
		if err != nil {
			return fmt.Errorf("open Stagehand extension manifest: %w", err)
		}
		var manifest struct {
			Version string `json:"version"`
		}
		decodeErr := json.NewDecoder(io.LimitReader(source, 1<<20)).Decode(&manifest)
		closeErr := source.Close()
		if decodeErr != nil {
			return fmt.Errorf("decode Stagehand extension manifest: %w", decodeErr)
		}
		if closeErr != nil {
			return fmt.Errorf("close Stagehand extension manifest: %w", closeErr)
		}
		if manifest.Version != expectedVersion {
			return fmt.Errorf(
				"Stagehand extension version %q does not match extension package version %q",
				manifest.Version,
				expectedVersion,
			)
		}
		return nil
	}
	return errors.New("built Stagehand extension has no manifest")
}
