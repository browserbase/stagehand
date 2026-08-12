package stagehand

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestNegotiateRuntimeCompatibility(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		marker     string
		compatible bool
		detail     string
	}{
		{
			name: "compatible",
			marker: `{
				"protocolVersion": "1.0.9",
				"serverInfo": {"name": "stagehand", "version": "1.0.0"}
			}`,
			compatible: true,
			detail:     "protocolVersion=1.0.9",
		},
		{
			name:       "missing marker",
			marker:     `null`,
			compatible: false,
			detail:     "no Stagehand runtime marker",
		},
		{
			name: "major mismatch",
			marker: `{
				"protocolVersion": "2.0.0",
				"serverInfo": {"name": "stagehand", "version": "1.0.0"}
			}`,
			compatible: false,
			detail:     "major mismatch",
		},
		{
			name: "wrong runtime",
			marker: `{
				"protocolVersion": "1.0.0",
				"serverInfo": {"name": "other", "version": "1.0.0"}
			}`,
			compatible: false,
			detail:     `serverInfo.name="other"`,
		},
		{
			name: "invalid protocol version",
			marker: `{
				"protocolVersion": 1,
				"serverInfo": {"name": "stagehand", "version": "1.0.0"}
			}`,
			compatible: false,
			detail:     "protocolVersion=1",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			compatible, detail := negotiateRuntimeCompatibility(
				json.RawMessage(test.marker),
			)
			if compatible != test.compatible {
				t.Fatalf("compatible = %t, want %t", compatible, test.compatible)
			}
			if !strings.Contains(detail, test.detail) {
				t.Fatalf("detail = %q, want it to contain %q", detail, test.detail)
			}
		})
	}
}

func TestProtocolCompatibility(t *testing.T) {
	t.Parallel()

	for _, test := range []struct {
		name       string
		client     string
		server     string
		compatible bool
		detail     string
	}{
		{name: "patch ignored", client: "1.2.4", server: "1.2.0", compatible: true},
		{name: "newer server minor", client: "1.2.4", server: "1.9.0", compatible: true},
		{name: "server too old", client: "1.2.4", server: "1.1.99", detail: "older"},
		{name: "major mismatch", client: "1.2.4", server: "2.0.0", detail: "major mismatch"},
		{name: "exact prerelease", client: "1.3.0-beta.1", server: "1.3.0-beta.1", compatible: true},
		{name: "different prerelease", client: "1.3.0-beta.1", server: "1.3.0-beta.2", detail: "match exactly"},
		{name: "invalid client", client: "not-semver", server: "1.3.0", detail: "invalid protocol version"},
		{name: "invalid server", client: "1.3.0", server: "not-semver", detail: "invalid protocol version"},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			compatible, detail := protocolCompatibility(test.client, test.server)
			if compatible != test.compatible {
				t.Fatalf("compatible = %t, want %t", compatible, test.compatible)
			}
			if !strings.Contains(detail, test.detail) {
				t.Fatalf("detail = %q, want it to contain %q", detail, test.detail)
			}
		})
	}
}
