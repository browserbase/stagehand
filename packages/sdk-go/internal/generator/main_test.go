package main

import (
	"strings"
	"testing"
)

func TestGenerateProtocolVersionSourceUsesPackageVersion(t *testing.T) {
	t.Parallel()

	for _, version := range []string{
		"7.12.3",
		"7.12.3-beta.1",
		"7.12.3-beta.1+sha.abc123",
	} {
		source, err := generateProtocolVersionSource([]byte(`{"version":"` + version + `"}`))
		if err != nil {
			t.Fatalf("generateProtocolVersionSource(%q) error = %v", version, err)
		}
		expected := `const stagehandProtocolVersion = "` + version + `"`
		if !strings.Contains(string(source), expected) {
			t.Fatalf("generated source = %q, want it to contain %q", source, expected)
		}
	}
}

func TestGenerateProtocolVersionSourceRejectsInvalidVersions(t *testing.T) {
	t.Parallel()

	for _, packageData := range []string{
		`{}`,
		`{"version":""}`,
		`{"version":"v1.2.3"}`,
		`{"version":"1.2"}`,
		`{"version":"1.2.3-01"}`,
		`{"version":"1.2.3+"}`,
		`{"version":"not-semver"}`,
	} {
		_, err := generateProtocolVersionSource([]byte(packageData))
		if err == nil {
			t.Errorf("generateProtocolVersionSource(%s) accepted invalid version", packageData)
		}
	}
}

func TestGenerateSDKVersionSourceUsesPackageVersion(t *testing.T) {
	t.Parallel()

	for _, version := range []string{
		"4.12.3",
		"4.0.1-next.0",
		"4.0.1-next.0+sha.abc123",
	} {
		source, err := generateSDKVersionSource([]byte(`{"version":"` + version + `"}`))
		if err != nil {
			t.Fatalf("generateSDKVersionSource(%q) error = %v", version, err)
		}
		expected := `const stagehandSDKVersion = "` + version + `"`
		if !strings.Contains(string(source), expected) {
			t.Fatalf("generated source = %q, want it to contain %q", source, expected)
		}
	}
}

func TestGenerateSDKVersionSourceRejectsInvalidVersion(t *testing.T) {
	t.Parallel()

	for _, packageData := range []string{
		`{}`,
		`{"version":""}`,
		`{"version":"v4.0.0"}`,
		`{"version":"4.0"}`,
		`{"version":"4.0.0-01"}`,
		`{"version":"4.0.0+"}`,
		`{"version":"4.-1.0"}`,
		`{"version":"04.0.0"}`,
	} {
		if _, err := generateSDKVersionSource([]byte(packageData)); err == nil {
			t.Errorf("generateSDKVersionSource(%s) accepted an invalid version", packageData)
		}
	}
}
