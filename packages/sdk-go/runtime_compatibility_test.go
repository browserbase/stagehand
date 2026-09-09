package stagehand

import (
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"testing"

	"golang.org/x/mod/semver"
)

// incompatibleMajorProtocolVersion derives a protocol version whose major is
// one above the SDK's current protocol so tests never hardcode a version that
// silently becomes compatible after a protocol bump.
func incompatibleMajorProtocolVersion(t *testing.T) string {
	t.Helper()
	major := strings.TrimPrefix(semver.Major("v"+stagehandProtocolVersion), "v")
	value, err := strconv.Atoi(major)
	if err != nil {
		t.Fatalf("parse protocol major from %q: %v", stagehandProtocolVersion, err)
	}
	return fmt.Sprintf("%d.0.0", value+1)
}

func runtimeMarkerJSON(protocolVersion any, serverName string) string {
	encoded, _ := json.Marshal(map[string]any{
		"protocolVersion": protocolVersion,
		"serverInfo":      map[string]any{"name": serverName, "version": "1.0.0"},
	})
	return string(encoded)
}

func TestNegotiateRuntimeCompatibility(t *testing.T) {
	t.Parallel()

	incompatibleMajor := incompatibleMajorProtocolVersion(t)

	tests := []struct {
		name   string
		marker string
		kind   runtimeCompatibilityKind
		reason string
		detail string
	}{
		{
			name:   "compatible",
			marker: runtimeMarkerJSON(stagehandProtocolVersion, stagehandRuntimeName),
			kind:   runtimeCompatibilityCompatible,
			detail: "protocolVersion=" + stagehandProtocolVersion,
		},
		{
			name:   "missing marker",
			marker: `null`,
			kind:   runtimeCompatibilityUnknown,
			detail: "no Stagehand runtime marker",
		},
		{
			name:   "empty marker",
			marker: ``,
			kind:   runtimeCompatibilityUnknown,
			detail: "no Stagehand runtime marker",
		},
		{
			name:   "unreadable marker",
			marker: `"not an object"`,
			kind:   runtimeCompatibilityUnknown,
			detail: "unreadable Stagehand runtime marker",
		},
		{
			name:   "missing serverInfo",
			marker: `{"protocolVersion": "` + stagehandProtocolVersion + `"}`,
			kind:   runtimeCompatibilityUnknown,
			detail: "serverInfo.name=<nil>",
		},
		{
			name:   "major mismatch",
			marker: runtimeMarkerJSON(incompatibleMajor, stagehandRuntimeName),
			kind:   runtimeCompatibilityIncompatible,
			reason: RuntimeIncompatibleReasonMajorMismatch,
			detail: "major mismatch",
		},
		{
			name:   "wrong runtime",
			marker: runtimeMarkerJSON(stagehandProtocolVersion, "other"),
			kind:   runtimeCompatibilityIncompatible,
			reason: RuntimeIncompatibleReasonRuntimeNameMismatch,
			detail: `Runtime name mismatch: expected "stagehand", server reported "other"`,
		},
		{
			name:   "non-semver protocol version",
			marker: runtimeMarkerJSON("not-semver", stagehandRuntimeName),
			kind:   runtimeCompatibilityIncompatible,
			reason: RuntimeIncompatibleReasonInvalidVersion,
			detail: "Invalid protocol version: client " + stagehandProtocolVersion + ", server not-semver",
		},
		{
			name:   "non-string protocol version",
			marker: runtimeMarkerJSON(1, stagehandRuntimeName),
			kind:   runtimeCompatibilityUnknown,
			detail: "protocolVersion=1",
		},
		{
			name:   "empty protocol version",
			marker: runtimeMarkerJSON("", stagehandRuntimeName),
			kind:   runtimeCompatibilityUnknown,
			detail: `protocolVersion=""`,
		},
		{
			name:   "null serverInfo",
			marker: `{"protocolVersion": "` + stagehandProtocolVersion + `", "serverInfo": null}`,
			kind:   runtimeCompatibilityUnknown,
			detail: `serverInfo.name=""`,
		},
		{
			name:   "empty serverInfo name",
			marker: `{"protocolVersion": "` + stagehandProtocolVersion + `", "serverInfo": {"name": "", "version": "1.0.0"}}`,
			kind:   runtimeCompatibilityUnknown,
			detail: `serverInfo.name=""`,
		},
		{
			name:   "empty serverInfo version",
			marker: `{"protocolVersion": "` + stagehandProtocolVersion + `", "serverInfo": {"name": "stagehand", "version": ""}}`,
			kind:   runtimeCompatibilityUnknown,
			detail: `serverInfo.version=""`,
		},
		{
			name:   "missing serverInfo version",
			marker: `{"protocolVersion": "` + stagehandProtocolVersion + `", "serverInfo": {"name": "stagehand"}}`,
			kind:   runtimeCompatibilityUnknown,
			detail: `serverInfo.version=""`,
		},
		{
			name:   "non-string serverInfo version",
			marker: `{"protocolVersion": "` + stagehandProtocolVersion + `", "serverInfo": {"name": "stagehand", "version": 1}}`,
			kind:   runtimeCompatibilityUnknown,
			detail: "serverInfo.name=<nil>",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			compat := negotiateRuntimeCompatibility(json.RawMessage(test.marker))
			if compat.Kind != test.kind {
				t.Fatalf("kind = %s, want %s (detail %q)", compat.Kind, test.kind, compat.Detail)
			}
			if compat.Reason != test.reason {
				t.Fatalf("reason = %q, want %q", compat.Reason, test.reason)
			}
			if !strings.Contains(compat.Detail, test.detail) {
				t.Fatalf("detail = %q, want it to contain %q", compat.Detail, test.detail)
			}
			err := compat.incompatibleError()
			if (err != nil) != (test.kind == runtimeCompatibilityIncompatible) {
				t.Fatalf("incompatibleError() = %v for kind %s", err, compat.Kind)
			}
		})
	}
}

func TestRuntimeIncompatibleErrorCarriesNegotiationFields(t *testing.T) {
	t.Parallel()

	incompatibleMajor := incompatibleMajorProtocolVersion(t)
	compat := negotiateRuntimeCompatibility(json.RawMessage(
		`{"protocolVersion": "` + incompatibleMajor + `", "serverInfo": {"name": "stagehand", "version": "9.9.9"}}`,
	))
	var err error = compat.incompatibleError()

	var incompatible *RuntimeIncompatibleError
	if !errors.As(err, &incompatible) {
		t.Fatalf("errors.As(*RuntimeIncompatibleError) failed for %T", err)
	}
	if incompatible.Reason != RuntimeIncompatibleReasonMajorMismatch {
		t.Fatalf("Reason = %q", incompatible.Reason)
	}
	if incompatible.ClientProtocolVersion != stagehandProtocolVersion {
		t.Fatalf("ClientProtocolVersion = %q", incompatible.ClientProtocolVersion)
	}
	if incompatible.ExtensionProtocolVersion != incompatibleMajor {
		t.Fatalf("ExtensionProtocolVersion = %q", incompatible.ExtensionProtocolVersion)
	}
	if incompatible.ServerInfo != (ImplementationInfo{Name: "stagehand", Version: "9.9.9"}) {
		t.Fatalf("ServerInfo = %#v", incompatible.ServerInfo)
	}
	message := err.Error()
	for _, want := range []string{
		"Incompatible Stagehand runtime (protocol-major-mismatch)",
		"client protocol " + stagehandProtocolVersion,
		"extension protocol " + incompatibleMajor,
		"extension stagehand/9.9.9",
		runtimeIncompatibleRemediation,
	} {
		if !strings.Contains(message, want) {
			t.Fatalf("Error() = %q, want it to contain %q", message, want)
		}
	}
}

func TestProtocolCompatibility(t *testing.T) {
	t.Parallel()

	for _, test := range []struct {
		name   string
		client string
		server string
		kind   runtimeCompatibilityKind
		reason string
		detail string
	}{
		{name: "patch ignored", client: "1.2.4", server: "1.2.0", kind: runtimeCompatibilityCompatible},
		{name: "newer server minor", client: "1.2.4", server: "1.9.0", kind: runtimeCompatibilityCompatible},
		// Detail wording is shared verbatim with the TypeScript and Python SDKs.
		{name: "server too old", client: "1.2.4", server: "1.1.99", kind: runtimeCompatibilityIncompatible, reason: RuntimeIncompatibleReasonServerTooOld, detail: "Server protocol 1.1.99 is older than client requirement 1.2.4"},
		{name: "major mismatch", client: "1.2.4", server: "2.0.0", kind: runtimeCompatibilityIncompatible, reason: RuntimeIncompatibleReasonMajorMismatch, detail: "Protocol major mismatch: client 1.2.4, server 2.0.0"},
		{name: "exact prerelease", client: "1.3.0-beta.1", server: "1.3.0-beta.1", kind: runtimeCompatibilityCompatible},
		{name: "different prerelease", client: "1.3.0-beta.1", server: "1.3.0-beta.2", kind: runtimeCompatibilityIncompatible, reason: RuntimeIncompatibleReasonPrereleaseMismatch, detail: "Protocol prereleases must match exactly: client 1.3.0-beta.1, server 1.3.0-beta.2"},
		{name: "invalid client", client: "not-semver", server: "1.3.0", kind: runtimeCompatibilityIncompatible, reason: RuntimeIncompatibleReasonInvalidVersion, detail: "Invalid protocol version: client not-semver, server 1.3.0"},
		{name: "invalid server", client: "1.3.0", server: "not-semver", kind: runtimeCompatibilityIncompatible, reason: RuntimeIncompatibleReasonInvalidVersion, detail: "Invalid protocol version: client 1.3.0, server not-semver"},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			compat := protocolCompatibility(test.client, test.server)
			if compat.Kind != test.kind {
				t.Fatalf("kind = %s, want %s", compat.Kind, test.kind)
			}
			if compat.Reason != test.reason {
				t.Fatalf("reason = %q, want %q", compat.Reason, test.reason)
			}
			if !strings.Contains(compat.Detail, test.detail) {
				t.Fatalf("detail = %q, want it to contain %q", compat.Detail, test.detail)
			}
		})
	}
}
