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
				"protocolVersion": 4,
				"serverInfo": {"name": "stagehand", "version": "4.0.0"}
			}`,
			compatible: true,
			detail:     "protocolVersion=4",
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
				"protocolVersion": 3,
				"serverInfo": {"name": "stagehand", "version": "3.0.0"}
			}`,
			compatible: false,
			detail:     "below",
		},
		{
			name: "above range",
			marker: `{
				"protocolVersion": 5,
				"serverInfo": {"name": "stagehand", "version": "5.0.0"}
			}`,
			compatible: false,
			detail:     "above",
		},
		{
			name: "wrong runtime",
			marker: `{
				"protocolVersion": 4,
				"serverInfo": {"name": "other", "version": "4.0.0"}
			}`,
			compatible: false,
			detail:     `serverInfo.name="other"`,
		},
		{
			name: "invalid protocol version",
			marker: `{
				"protocolVersion": "4",
				"serverInfo": {"name": "stagehand", "version": "4.0.0"}
			}`,
			compatible: false,
			detail:     "protocolVersion=4",
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
