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
