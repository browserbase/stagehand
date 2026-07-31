// Package extensionassets exposes the Stagehand extension bundled into the Go
// module. It is internal so the SDK can share one artifact between local Chrome
// and Browserbase without adding a public asset API.
package extensionassets

import (
	"archive/zip"
	"bytes"
	_ "embed"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"
)

//go:embed stagehand-extension.zip
var stagehandExtensionArchive []byte

// Archive returns a copy of the ZIP uploaded when Browserbase needs the
// Stagehand extension.
func Archive() []byte {
	return bytes.Clone(stagehandExtensionArchive)
}

// Materialize extracts the bundled extension for a local Chrome process. The
// caller owns cleanup and should invoke it when the browser closes.
func Materialize() (directory string, cleanup func() error, err error) {
	return materialize(stagehandExtensionArchive, "")
}

func materialize(archive []byte, parentDirectory string) (string, func() error, error) {
	reader, err := zip.NewReader(bytes.NewReader(archive), int64(len(archive)))
	if err != nil {
		return "", nil, fmt.Errorf("open bundled Stagehand extension: %w", err)
	}

	directory, err := os.MkdirTemp(parentDirectory, "stagehand-extension-")
	if err != nil {
		return "", nil, fmt.Errorf("create Stagehand extension directory: %w", err)
	}
	cleanup := func() error {
		return os.RemoveAll(directory)
	}
	fail := func(err error) (string, func() error, error) {
		return "", nil, errors.Join(err, cleanup())
	}

	seen := make(map[string]struct{}, len(reader.File))
	for _, file := range reader.File {
		relativePath, err := safeArchivePath(file.Name)
		if err != nil {
			return fail(err)
		}
		if _, exists := seen[relativePath]; exists {
			return fail(fmt.Errorf(
				"bundled Stagehand extension contains duplicate path %q",
				relativePath,
			))
		}
		seen[relativePath] = struct{}{}

		targetPath := filepath.Join(directory, filepath.FromSlash(relativePath))
		relativeTarget, err := filepath.Rel(directory, targetPath)
		if err != nil ||
			relativeTarget == ".." ||
			strings.HasPrefix(relativeTarget, ".."+string(filepath.Separator)) {
			return fail(fmt.Errorf(
				"bundled Stagehand extension has unsafe path %q",
				file.Name,
			))
		}
		mode := file.FileInfo().Mode()
		switch {
		case mode&os.ModeSymlink != 0:
			return fail(fmt.Errorf(
				"bundled Stagehand extension contains symbolic link %q",
				relativePath,
			))
		case file.FileInfo().IsDir():
			if err := os.MkdirAll(targetPath, 0o755); err != nil {
				return fail(fmt.Errorf(
					"create Stagehand extension directory %q: %w",
					relativePath,
					err,
				))
			}
		case !mode.IsRegular():
			return fail(fmt.Errorf(
				"bundled Stagehand extension contains unsupported file %q",
				relativePath,
			))
		default:
			if err := extractFile(file, targetPath); err != nil {
				return fail(err)
			}
		}
	}

	if _, err := os.Stat(filepath.Join(directory, "manifest.json")); err != nil {
		return fail(fmt.Errorf("bundled Stagehand extension has no manifest: %w", err))
	}
	return directory, cleanup, nil
}

func safeArchivePath(name string) (string, error) {
	cleaned := path.Clean(name)
	if cleaned == "." ||
		strings.Contains(name, `\`) ||
		path.IsAbs(cleaned) ||
		filepath.IsAbs(filepath.FromSlash(cleaned)) ||
		cleaned == ".." ||
		strings.HasPrefix(cleaned, "../") {
		return "", fmt.Errorf("bundled Stagehand extension has unsafe path %q", name)
	}
	return cleaned, nil
}

func extractFile(file *zip.File, targetPath string) error {
	if err := os.MkdirAll(filepath.Dir(targetPath), 0o755); err != nil {
		return fmt.Errorf("create Stagehand extension parent directory: %w", err)
	}

	source, err := file.Open()
	if err != nil {
		return fmt.Errorf("open Stagehand extension file %q: %w", file.Name, err)
	}
	defer source.Close()

	target, err := os.OpenFile(targetPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		return fmt.Errorf("create Stagehand extension file %q: %w", file.Name, err)
	}
	if _, err := io.Copy(target, source); err != nil {
		_ = target.Close()
		return fmt.Errorf("extract Stagehand extension file %q: %w", file.Name, err)
	}
	if err := target.Close(); err != nil {
		return fmt.Errorf("close Stagehand extension file %q: %w", file.Name, err)
	}
	return nil
}
