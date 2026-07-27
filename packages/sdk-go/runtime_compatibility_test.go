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
				"protocolVersion": 1,
				"serverInfo": {"name": "stagehand", "version": "4.0.0"}
			}`,
			compatible: true,
			detail:     "protocolVersion=1",
		},
		{
			name:       "missing marker",
			marker:     `null`,
			compatible: false,
			detail:     "no Stagehand runtime marker",
		},
		{
			name: "below range",
			marker: `{
				"protocolVersion": 0,
				"serverInfo": {"name": "stagehand", "version": "4.0.0"}
			}`,
			compatible: false,
			detail:     "below",
		},
		{
			name: "above range",
			marker: `{
				"protocolVersion": 2,
				"serverInfo": {"name": "stagehand", "version": "4.0.0"}
			}`,
			compatible: false,
			detail:     "above",
		},
		{
			name: "wrong runtime",
			marker: `{
				"protocolVersion": 1,
				"serverInfo": {"name": "other", "version": "4.0.0"}
			}`,
			compatible: false,
			detail:     `serverInfo.name="other"`,
		},
		{
			name: "invalid protocol version",
			marker: `{
				"protocolVersion": "1",
				"serverInfo": {"name": "stagehand", "version": "4.0.0"}
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
