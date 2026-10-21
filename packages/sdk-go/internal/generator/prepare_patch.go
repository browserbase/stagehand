package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
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
	if err := os.WriteFile(manifestPath, updated, 0o644); err != nil {
		return fmt.Errorf("write SDK package: %w", err)
	}
	if err := os.WriteFile(identityPath, source, 0o644); err != nil {
		// Restore the original pair if writing the generated identity fails.
		return errors.Join(
			fmt.Errorf("write generated SDK version: %w", err),
			os.WriteFile(manifestPath, manifest, 0o644),
			os.WriteFile(identityPath, identity, 0o644),
		)
	}
	return nil
}
