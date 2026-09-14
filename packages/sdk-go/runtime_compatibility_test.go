package stagehand

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"testing"
)

func TestNegotiateRuntimeCompatibility(t *testing.T) {
	t.Parallel()

	protocolMajor, err := strconv.Atoi(strings.Split(stagehandProtocolVersion, ".")[0])
	if err != nil {
		t.Fatal(err)
	}
	incompatibleProtocolVersion := fmt.Sprintf("%d.0.0", protocolMajor+1)

	tests := []struct {
		name   string
		marker string
		kind   runtimeCompatibilityKind
		reason string
		detail string
	}{
		{
			name: "compatible",
			marker: fmt.Sprintf(`{
				"protocolVersion": %q,
				"serverInfo": {"name": "stagehand", "version": "1.0.0"}
			}`, stagehandProtocolVersion),
			kind:   runtimeCompatible,
			detail: "protocolVersion=" + stagehandProtocolVersion,
		},
		{
			name:   "missing marker",
			marker: `null`,
			kind:   runtimeUnknown,
			detail: "no Stagehand runtime marker",
		},
		{
			name:   "empty marker",
			marker: `{}`,
			kind:   runtimeUnknown,
			detail: "serverInfo.name=",
		},
		{
			name: "null serverInfo",
			marker: fmt.Sprintf(`{
				"protocolVersion": %q,
				"serverInfo": null
			}`, stagehandProtocolVersion),
			kind:   runtimeUnknown,
			detail: `serverInfo.name=""`,
		},
		{
			name: "non-object serverInfo",
			marker: fmt.Sprintf(`{
				"protocolVersion": %q,
				"serverInfo": "stagehand"
			}`, stagehandProtocolVersion),
			kind:   runtimeUnknown,
			detail: "serverInfo.name=<nil>",
		},
		{
			name: "empty server name",
			marker: fmt.Sprintf(`{
				"protocolVersion": %q,
				"serverInfo": {"name": "", "version": "1.0.0"}
			}`, stagehandProtocolVersion),
			kind:   runtimeUnknown,
			detail: `serverInfo.name=""`,
		},
		{
			name: "empty server version",
			marker: fmt.Sprintf(`{
				"protocolVersion": %q,
				"serverInfo": {"name": "stagehand", "version": ""}
			}`, stagehandProtocolVersion),
			kind:   runtimeUnknown,
			detail: `serverInfo.version=""`,
		},
		{
			name: "missing server version",
			marker: fmt.Sprintf(`{
				"protocolVersion": %q,
				"serverInfo": {"name": "stagehand"}
			}`, stagehandProtocolVersion),
			kind:   runtimeUnknown,
			detail: `serverInfo.version=""`,
		},
		{
			name: "major mismatch",
			marker: fmt.Sprintf(`{
				"protocolVersion": %q,
				"serverInfo": {"name": "stagehand", "version": "1.0.0"}
			}`, incompatibleProtocolVersion),
			kind:   runtimeIncompatible,
			reason: "protocol-major-mismatch",
			detail: fmt.Sprintf(
				"Protocol major mismatch: client %s, server %s",
				stagehandProtocolVersion,
				incompatibleProtocolVersion,
			),
		},
		{
			name: "wrong runtime",
			marker: fmt.Sprintf(`{
				"protocolVersion": %q,
				"serverInfo": {"name": "other", "version": "1.0.0"}
			}`, stagehandProtocolVersion),
			kind:   runtimeIncompatible,
			reason: "runtime-name-mismatch",
			detail: `Runtime name mismatch: expected "stagehand", server reported "other"`,
		},
		{
			name: "invalid protocol version",
			marker: `{
				"protocolVersion": 1,
				"serverInfo": {"name": "stagehand", "version": "1.0.0"}
			}`,
			kind:   runtimeUnknown,
			detail: "protocolVersion=1",
		},
		{
			name: "empty protocol version",
			marker: `{
				"protocolVersion": "",
				"serverInfo": {"name": "stagehand", "version": "1.0.0"}
			}`,
			kind:   runtimeUnknown,
			detail: "protocolVersion=",
		},
		{
			name: "non-semver protocol version",
			marker: `{
				"protocolVersion": "not-semver",
				"serverInfo": {"name": "stagehand", "version": "1.0.0"}
			}`,
			kind:   runtimeIncompatible,
			reason: "protocol-invalid-version",
			detail: fmt.Sprintf(
				"Invalid protocol version: client %s, server not-semver",
				stagehandProtocolVersion,
			),
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			negotiation := negotiateRuntimeCompatibility(
				json.RawMessage(test.marker),
			)
			if negotiation.kind != test.kind {
				t.Fatalf("kind = %q, want %q", negotiation.kind, test.kind)
			}
			if negotiation.reason != test.reason {
				t.Fatalf("reason = %q, want %q", negotiation.reason, test.reason)
			}
			if !strings.Contains(negotiation.detail, test.detail) {
				t.Fatalf("detail = %q, want it to contain %q", negotiation.detail, test.detail)
			}
			if negotiation.compatible() != (test.kind == runtimeCompatible) {
				t.Fatalf("compatible() = %t for kind %q", negotiation.compatible(), negotiation.kind)
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
		reason     string
		detail     string
	}{
		{name: "patch ignored", client: "1.2.4", server: "1.2.0", compatible: true},
		{name: "newer server minor", client: "1.2.4", server: "1.9.0", compatible: true},
		// Detail wording is the TS SDK's compatibilityDetail; keep the SDKs identical.
		{name: "server too old", client: "1.2.4", server: "1.1.99", reason: "protocol-server-too-old", detail: "Server protocol 1.1.99 is older than client requirement 1.2.4"},
		{name: "major mismatch", client: "1.2.4", server: "2.0.0", reason: "protocol-major-mismatch", detail: "Protocol major mismatch: client 1.2.4, server 2.0.0"},
		{name: "exact prerelease", client: "1.3.0-beta.1", server: "1.3.0-beta.1", compatible: true},
		{name: "different prerelease", client: "1.3.0-beta.1", server: "1.3.0-beta.2", reason: "protocol-prerelease-mismatch", detail: "Protocol prereleases must match exactly: client 1.3.0-beta.1, server 1.3.0-beta.2"},
		{name: "invalid client", client: "not-semver", server: "1.3.0", reason: "protocol-invalid-version", detail: "Invalid protocol version: client not-semver, server 1.3.0"},
		{name: "invalid server", client: "1.3.0", server: "not-semver", reason: "protocol-invalid-version", detail: "Invalid protocol version: client 1.3.0, server not-semver"},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			compatible, reason, detail := protocolCompatibility(test.client, test.server)
			if compatible != test.compatible {
				t.Fatalf("compatible = %t, want %t", compatible, test.compatible)
			}
			if reason != test.reason {
				t.Fatalf("reason = %q, want %q", reason, test.reason)
			}
			if !strings.Contains(detail, test.detail) {
				t.Fatalf("detail = %q, want it to contain %q", detail, test.detail)
			}
		})
	}
}
