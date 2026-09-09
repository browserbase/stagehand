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

// Reasons carried by RuntimeIncompatibleError.Reason. They mirror the
// TypeScript and Python clients so cross-SDK diagnostics line up.
const (
	RuntimeIncompatibleReasonInvalidVersion      = "protocol-invalid-version"
	RuntimeIncompatibleReasonMajorMismatch       = "protocol-major-mismatch"
	RuntimeIncompatibleReasonServerTooOld        = "protocol-server-too-old"
	RuntimeIncompatibleReasonPrereleaseMismatch  = "protocol-prerelease-mismatch"
	RuntimeIncompatibleReasonRuntimeNameMismatch = "runtime-name-mismatch"
)

// runtimeIncompatibleRemediation is the one-line hint appended to every
// RuntimeIncompatibleError message.
const runtimeIncompatibleRemediation = "Upgrade the Stagehand SDK and the " +
	"Stagehand extension together so their protocol majors match, or start " +
	"the session with the extension bundled in this SDK."

// RuntimeIncompatibleError is returned when the connected Stagehand extension
// publishes a runtime marker that this SDK cannot talk to: the protocol major
// differs, the extension is older than the SDK requires, a prerelease does not
// match exactly, or the marker was published by a different runtime.
//
// The client fails fast instead of polling until the initialization timeout;
// callers can detect it with errors.As.
type RuntimeIncompatibleError struct {
	// Reason is one of the RuntimeIncompatibleReason* constants.
	Reason string
	// Detail is the human-readable negotiation outcome.
	Detail string
	// ClientProtocolVersion is the protocol version this SDK speaks.
	ClientProtocolVersion string
	// ExtensionProtocolVersion is the protocol version the extension reported.
	ExtensionProtocolVersion string
	// ServerInfo is the extension's reported serverInfo (name and version).
	ServerInfo ImplementationInfo
}

func (err *RuntimeIncompatibleError) Error() string {
	return fmt.Sprintf(
		"Incompatible Stagehand runtime (%s): %s; client protocol %s, extension protocol %s, extension %s/%s. %s",
		err.Reason,
		err.Detail,
		err.ClientProtocolVersion,
		err.ExtensionProtocolVersion,
		err.ServerInfo.Name,
		err.ServerInfo.Version,
		runtimeIncompatibleRemediation,
	)
}

// runtimeCompatibilityKind is the three-way outcome of reading the runtime
// marker: compatible, definitively incompatible, or not (yet) decidable.
type runtimeCompatibilityKind int

const (
	// runtimeCompatibilityUnknown means the marker is absent, not yet set, or
	// unreadable. Callers should keep polling.
	runtimeCompatibilityUnknown runtimeCompatibilityKind = iota
	// runtimeCompatibilityIncompatible means the marker parsed but the
	// protocol rules (or runtime name) reject it. Polling cannot fix this.
	runtimeCompatibilityIncompatible
	// runtimeCompatibilityCompatible means the extension can be used.
	runtimeCompatibilityCompatible
)

func (kind runtimeCompatibilityKind) String() string {
	switch kind {
	case runtimeCompatibilityCompatible:
		return "compatible"
	case runtimeCompatibilityIncompatible:
		return "incompatible"
	default:
		return "unknown"
	}
}

type runtimeCompatibility struct {
	Kind   runtimeCompatibilityKind
	Reason string
	Detail string
	// Reported fields are populated whenever the marker parsed, i.e. for
	// compatible and incompatible outcomes.
	ReportedProtocolVersion string
	ServerInfo              ImplementationInfo
}

// incompatibleError converts an incompatible negotiation into the exported
// error type. It returns nil for any other kind.
func (compat runtimeCompatibility) incompatibleError() *RuntimeIncompatibleError {
	if compat.Kind != runtimeCompatibilityIncompatible {
		return nil
	}
	return &RuntimeIncompatibleError{
		Reason:                   compat.Reason,
		Detail:                   compat.Detail,
		ClientProtocolVersion:    stagehandProtocolVersion,
		ExtensionProtocolVersion: compat.ReportedProtocolVersion,
		ServerInfo:               compat.ServerInfo,
	}
}

// negotiateRuntimeCompatibility deliberately mirrors the TypeScript and
// Python clients. The runtime marker is transport state, while ServerInfo
// reuses the protocol-generated ImplementationInfo struct.
func negotiateRuntimeCompatibility(raw json.RawMessage) runtimeCompatibility {
	if len(raw) == 0 || bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return runtimeCompatibility{
			Kind:   runtimeCompatibilityUnknown,
			Detail: "no Stagehand runtime marker",
		}
	}

	var marker map[string]json.RawMessage
	if err := json.Unmarshal(raw, &marker); err != nil {
		return runtimeCompatibility{
			Kind:   runtimeCompatibilityUnknown,
			Detail: "unreadable Stagehand runtime marker",
		}
	}

	// Mirrors the protocol's ImplementationInfoSchema: both fields are non-empty
	// strings. A marker missing either is malformed, not a foreign runtime, so
	// keep polling.
	var serverInfo ImplementationInfo
	if err := json.Unmarshal(marker["serverInfo"], &serverInfo); err != nil {
		return runtimeCompatibility{
			Kind:   runtimeCompatibilityUnknown,
			Detail: "unreadable Stagehand runtime marker: serverInfo.name=<nil>",
		}
	}
	if serverInfo.Name == "" || serverInfo.Version == "" {
		return runtimeCompatibility{
			Kind: runtimeCompatibilityUnknown,
			Detail: fmt.Sprintf(
				"unreadable Stagehand runtime marker: serverInfo.name=%q serverInfo.version=%q",
				serverInfo.Name,
				serverInfo.Version,
			),
			ServerInfo: serverInfo,
		}
	}

	var protocolVersion string
	if err := json.Unmarshal(marker["protocolVersion"], &protocolVersion); err != nil || protocolVersion == "" {
		return runtimeCompatibility{
			Kind: runtimeCompatibilityUnknown,
			Detail: fmt.Sprintf(
				"unreadable Stagehand runtime marker: protocolVersion=%s",
				rawJSONDescription(marker["protocolVersion"]),
			),
			ServerInfo: serverInfo,
		}
	}

	if serverInfo.Name != stagehandRuntimeName {
		return runtimeCompatibility{
			Kind:                    runtimeCompatibilityIncompatible,
			Reason:                  RuntimeIncompatibleReasonRuntimeNameMismatch,
			Detail:                  fmt.Sprintf("Runtime name mismatch: expected %q, server reported %q", stagehandRuntimeName, serverInfo.Name),
			ReportedProtocolVersion: protocolVersion,
			ServerInfo:              serverInfo,
		}
	}

	compat := protocolCompatibility(stagehandProtocolVersion, protocolVersion)
	compat.ReportedProtocolVersion = protocolVersion
	compat.ServerInfo = serverInfo
	return compat
}

func protocolCompatibility(clientProtocolVersion, serverProtocolVersion string) runtimeCompatibility {
	incompatible := func(reason, detail string) runtimeCompatibility {
		return runtimeCompatibility{
			Kind:   runtimeCompatibilityIncompatible,
			Reason: reason,
			Detail: detail,
		}
	}
	compatible := runtimeCompatibility{
		Kind:   runtimeCompatibilityCompatible,
		Detail: fmt.Sprintf("protocolVersion=%s", serverProtocolVersion),
	}

	clientVersion := "v" + clientProtocolVersion
	serverVersion := "v" + serverProtocolVersion
	if !validProtocolVersion(clientProtocolVersion) || !validProtocolVersion(serverProtocolVersion) {
		return incompatible(
			RuntimeIncompatibleReasonInvalidVersion,
			fmt.Sprintf(
				"Invalid protocol version: client %s, server %s",
				clientProtocolVersion,
				serverProtocolVersion,
			),
		)
	}
	if semver.Prerelease(clientVersion) != "" || semver.Prerelease(serverVersion) != "" {
		if serverProtocolVersion != clientProtocolVersion {
			return incompatible(
				RuntimeIncompatibleReasonPrereleaseMismatch,
				fmt.Sprintf(
					"Protocol prereleases must match exactly: client %s, server %s",
					clientProtocolVersion,
					serverProtocolVersion,
				),
			)
		}
		return compatible
	}
	if semver.Major(clientVersion) != semver.Major(serverVersion) {
		return incompatible(
			RuntimeIncompatibleReasonMajorMismatch,
			fmt.Sprintf(
				"Protocol major mismatch: client %s, server %s",
				clientProtocolVersion,
				serverProtocolVersion,
			),
		)
	}
	clientMinor := semver.MajorMinor(clientVersion) + ".0"
	serverMinor := semver.MajorMinor(serverVersion) + ".0"
	if semver.Compare(serverMinor, clientMinor) < 0 {
		return incompatible(
			RuntimeIncompatibleReasonServerTooOld,
			fmt.Sprintf(
				"Server protocol %s is older than client requirement %s",
				serverProtocolVersion,
				clientProtocolVersion,
			),
		)
	}

	return compatible
}

func validProtocolVersion(version string) bool {
	coreVersion := version
	if suffixIndex := strings.IndexAny(coreVersion, "-+"); suffixIndex >= 0 {
		coreVersion = coreVersion[:suffixIndex]
	}
	return strings.Count(coreVersion, ".") == 2 && semver.IsValid("v"+version)
}
