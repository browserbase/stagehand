package main

import (
	"strings"
	"testing"
)

func TestGenerateProtocolVersionSourceUsesPackageMajor(t *testing.T) {
	t.Parallel()

	source, err := generateProtocolVersionSource([]byte(`{"version":"7.12.3"}`))
	if err != nil {
		t.Fatalf("generateProtocolVersionSource() error = %v", err)
	}
	if !strings.Contains(string(source), "const stagehandProtocolVersion = 7") {
		t.Fatalf("generated source = %q", source)
	}
}

func TestGenerateProtocolVersionSourceRejectsInvalidVersions(t *testing.T) {
	t.Parallel()

	for _, packageData := range []string{
		`{}`,
		`{"version":""}`,
		`{"version":"0.1.0"}`,
		`{"version":"v1.2.3"}`,
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
