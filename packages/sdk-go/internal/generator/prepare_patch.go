package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/mod/semver"
)

// preparePatch updates only the Go release identity. Protocol generation and
// extension rebuilding/repacking remain explicit steps for patches that need them.
func preparePatch(sdkRoot, version string) error {
	manifestPath := filepath.Join(sdkRoot, "package.json")
	manifest, err := os.ReadFile(manifestPath)
	if err != nil {
		return fmt.Errorf("read SDK package: %w", err)
	}
	current, err := sdkPackageVersion(manifest)
	if err != nil {
		return err
	}
	stableV4 := func(v string) bool {
		return validPackageVersion(v) && !strings.ContainsAny(v, "-+") && semver.Major("v"+v) == "v4"
	}
	if !stableV4(current) || !stableV4(version) ||
		semver.MajorMinor("v"+current) != semver.MajorMinor("v"+version) ||
		semver.Compare("v"+version, "v"+current) < 0 {
		return fmt.Errorf("expected %s or a newer stable patch in the same v4 minor line; got %q", current, version)
	}

	identityPath := filepath.Join(sdkRoot, sdkVersionFile)
	identity, err := os.ReadFile(identityPath)
	if err != nil {
		return fmt.Errorf("read generated SDK version: %w", err)
	}
	expected, err := generateSDKVersionSource(manifest)
	if err != nil {
		return err
	}
	if !bytes.Equal(identity, expected) {
		return errors.New("generated Go SDK version is stale; run the Go model generator before preparing a patch")
	}
	if version == current {
		return nil
	}

	var fields map[string]json.RawMessage
	if err := json.Unmarshal(manifest, &fields); err != nil {
		return err
	}
	fields["version"], err = json.Marshal(version)
	if err != nil {
		return err
	}
	updated, err := json.MarshalIndent(fields, "", "  ")
	if err != nil {
		return err
	}
	updated = append(updated, '\n')
	source, err := generateSDKVersionSource(updated)
	if err != nil {
		return err
	}
	if err := writePatchFile(manifestPath, bytes.NewReader(updated)); err != nil {
		return fmt.Errorf("write SDK package: %w", err)
	}
	if err := writePatchFile(identityPath, bytes.NewReader(source)); err != nil {
		// The identity is untouched on failure; restore the original manifest too.
		return errors.Join(
			fmt.Errorf("write generated SDK version: %w", err),
			writePatchFile(manifestPath, bytes.NewReader(manifest)),
		)
	}
	return nil
}

// Finish writing and closing a file in the same directory before replacing the
// original, so a partial write cannot truncate an existing version file.
func writePatchFile(path string, contents io.Reader) error {
	temporary, err := os.CreateTemp(filepath.Dir(path), ".go-patch-*.tmp")
	if err != nil {
		return err
	}
	defer os.Remove(temporary.Name())
	defer temporary.Close()
	if err := temporary.Chmod(0o644); err != nil {
		return err
	}
	if _, err := io.Copy(temporary, contents); err != nil {
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	return os.Rename(temporary.Name(), path)
}
