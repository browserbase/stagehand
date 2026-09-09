package stagehand

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strings"

	"golang.org/x/mod/semver"
)

const (
	stagehandRuntimeName   = "stagehand"
	stagehandSDKClientName = "stagehand-sdk-go"
)

// RuntimeIncompatibleRemediation is the one-line hint appended to
// RuntimeIncompatibleError messages.
const RuntimeIncompatibleRemediation = "Upgrade the Stagehand SDK and the Stagehand extension " +
	"together so their protocol majors match, or start the session with the extension bundled " +
	"in this SDK."

// RuntimeIncompatibleError reports that the connected Stagehand extension
// publishes a runtime this SDK can never talk to. It is returned on the first
// readiness poll that observes the incompatible marker rather than after the
// initialization timeout, because the extension will not change its protocol
// version while the session is open. Use errors.As to inspect it.
type RuntimeIncompatibleError struct {
	// Reason is one of protocol-major-mismatch, protocol-server-too-old,
	// protocol-prerelease-mismatch, protocol-invalid-version or
	// runtime-name-mismatch.
	Reason string
	// ClientProtocolVersion is the protocol version this SDK speaks.
	ClientProtocolVersion string
	// ReportedProtocolVersion is the protocol version the extension published.
	ReportedProtocolVersion string
	// ServerInfo is the extension's own name and version.
	ServerInfo ImplementationInfo
	// Detail is the human-readable negotiation failure.
	Detail string
	// Remediation is a one-line hint on how to fix the mismatch.
	Remediation string
}

func (e *RuntimeIncompatibleError) Error() string {
	return fmt.Sprintf(
		"incompatible Stagehand runtime: %s; client protocol %s, reported protocol %s, server %s/%s. %s",
		e.Detail,
		e.ClientProtocolVersion,
		e.ReportedProtocolVersion,
		e.ServerInfo.Name,
		e.ServerInfo.Version,
		e.Remediation,
	)
}

type runtimeCompatibilityKind string

const (
	// runtimeCompatible: the marker parsed and this client can talk to it.
	runtimeCompatible runtimeCompatibilityKind = "compatible"
	// runtimeIncompatible: the marker parsed but this client can never talk
	// to it, so polling further is pointless.
	runtimeIncompatible runtimeCompatibilityKind = "incompatible"
	// runtimeUnknown: the marker is absent or not yet readable; keep polling.
	runtimeUnknown runtimeCompatibilityKind = "unknown"
)

type runtimeNegotiation struct {
	kind            runtimeCompatibilityKind
	reason          string
	detail          string
	protocolVersion string
	serverInfo      ImplementationInfo
}

func (n runtimeNegotiation) compatible() bool {
	return n.kind == runtimeCompatible
}

func (n runtimeNegotiation) incompatibleError() *RuntimeIncompatibleError {
	return &RuntimeIncompatibleError{
		Reason:                  n.reason,
		ClientProtocolVersion:   stagehandProtocolVersion,
		ReportedProtocolVersion: n.protocolVersion,
		ServerInfo:              n.serverInfo,
		Detail:                  n.detail,
		Remediation:             RuntimeIncompatibleRemediation,
	}
}

func unknownRuntime(detail string) runtimeNegotiation {
	return runtimeNegotiation{kind: runtimeUnknown, detail: detail}
}

// negotiateRuntimeCompatibility deliberately mirrors the TypeScript and
// Python clients. The runtime marker is transport state, while ServerInfo
// reuses the protocol-generated ImplementationInfo struct.
func negotiateRuntimeCompatibility(raw json.RawMessage) runtimeNegotiation {
	if len(raw) == 0 || bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return unknownRuntime("no Stagehand runtime marker")
	}

	var marker map[string]json.RawMessage
	if err := json.Unmarshal(raw, &marker); err != nil {
		return unknownRuntime("unreadable Stagehand runtime marker")
	}

	// Mirrors the protocol's ImplementationInfoSchema: both fields are non-empty
	// strings. A marker missing either is malformed, not a foreign runtime, so
	// keep polling.
	var serverInfo ImplementationInfo
	if err := json.Unmarshal(marker["serverInfo"], &serverInfo); err != nil {
		return unknownRuntime("serverInfo.name=<nil>")
	}
	if serverInfo.Name == "" || serverInfo.Version == "" {
		return unknownRuntime(fmt.Sprintf(
			"serverInfo.name=%q serverInfo.version=%q",
			serverInfo.Name,
			serverInfo.Version,
		))
	}

	var protocolVersion string
	if err := json.Unmarshal(marker["protocolVersion"], &protocolVersion); err != nil {
		return unknownRuntime(fmt.Sprintf(
			"protocolVersion=%s",
			rawJSONDescription(marker["protocolVersion"]),
		))
	}

	negotiation := runtimeNegotiation{
		protocolVersion: protocolVersion,
		serverInfo:      serverInfo,
	}
	if serverInfo.Name != stagehandRuntimeName {
		negotiation.kind = runtimeIncompatible
		negotiation.reason = "runtime-name-mismatch"
		negotiation.detail = fmt.Sprintf(
			"Connected runtime is not Stagehand: serverInfo.name=%q",
			serverInfo.Name,
		)
		return negotiation
	}

	compatible, reason, detail := protocolCompatibility(stagehandProtocolVersion, protocolVersion)
	negotiation.detail = detail
	if !compatible {
		negotiation.kind = runtimeIncompatible
		negotiation.reason = reason
		return negotiation
	}
	negotiation.kind = runtimeCompatible
	return negotiation
}

// protocolCompatibility returns whether the versions are compatible plus the
// machine-readable reason (empty when compatible) and a human-readable detail.
func protocolCompatibility(
	clientProtocolVersion, serverProtocolVersion string,
) (compatible bool, reason string, detail string) {
	clientVersion := "v" + clientProtocolVersion
	serverVersion := "v" + serverProtocolVersion
	if !validProtocolVersion(clientProtocolVersion) || !validProtocolVersion(serverProtocolVersion) {
		return false, "protocol-invalid-version", fmt.Sprintf(
			"Invalid protocol version: client %s, server %s",
			clientProtocolVersion,
			serverProtocolVersion,
		)
	}
	if semver.Prerelease(clientVersion) != "" || semver.Prerelease(serverVersion) != "" {
		if serverProtocolVersion != clientProtocolVersion {
			return false, "protocol-prerelease-mismatch", fmt.Sprintf(
				"Protocol prereleases must match exactly: client %s, server %s",
				clientProtocolVersion,
				serverProtocolVersion,
			)
		}
		return true, "", fmt.Sprintf("protocolVersion=%s", serverProtocolVersion)
	}
	if semver.Major(clientVersion) != semver.Major(serverVersion) {
		return false, "protocol-major-mismatch", fmt.Sprintf(
			"Protocol major mismatch: client %s, server %s",
			clientProtocolVersion,
			serverProtocolVersion,
		)
	}
	clientMinor := semver.MajorMinor(clientVersion) + ".0"
	serverMinor := semver.MajorMinor(serverVersion) + ".0"
	if semver.Compare(serverMinor, clientMinor) < 0 {
		return false, "protocol-server-too-old", fmt.Sprintf(
			"Server protocol %s is older than client requirement %s",
			serverProtocolVersion,
			clientProtocolVersion,
		)
	}

	return true, "", fmt.Sprintf("protocolVersion=%s", serverProtocolVersion)
}

func validProtocolVersion(version string) bool {
	coreVersion := version
	if suffixIndex := strings.IndexAny(coreVersion, "-+"); suffixIndex >= 0 {
		coreVersion = coreVersion[:suffixIndex]
	}
	return strings.Count(coreVersion, ".") == 2 && semver.IsValid("v"+version)
}
