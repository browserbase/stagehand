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

// negotiateRuntimeCompatibility deliberately mirrors the TypeScript and
// Python clients. The runtime marker is transport state, while ServerInfo
// reuses the protocol-generated ImplementationInfo struct.
func negotiateRuntimeCompatibility(raw json.RawMessage) (bool, string) {
	if len(raw) == 0 || bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return false, "no Stagehand runtime marker"
	}

	var marker map[string]json.RawMessage
	if err := json.Unmarshal(raw, &marker); err != nil {
		return false, "unreadable Stagehand runtime marker"
	}

	var serverInfo ImplementationInfo
	if err := json.Unmarshal(marker["serverInfo"], &serverInfo); err != nil {
		return false, "serverInfo.name=<nil>"
	}
	if serverInfo.Name != stagehandRuntimeName {
		return false, fmt.Sprintf("serverInfo.name=%q", serverInfo.Name)
	}

	var protocolVersion string
	if err := json.Unmarshal(marker["protocolVersion"], &protocolVersion); err != nil {
		return false, fmt.Sprintf(
			"protocolVersion=%s",
			rawJSONDescription(marker["protocolVersion"]),
		)
	}
	return protocolCompatibility(stagehandProtocolVersion, protocolVersion)
}

func protocolCompatibility(clientProtocolVersion, serverProtocolVersion string) (bool, string) {
	clientVersion := "v" + clientProtocolVersion
	serverVersion := "v" + serverProtocolVersion
	if !validProtocolVersion(clientProtocolVersion) || !validProtocolVersion(serverProtocolVersion) {
		return false, fmt.Sprintf(
			"invalid protocol version: client=%q server=%q",
			clientProtocolVersion,
			serverProtocolVersion,
		)
	}
	if semver.Prerelease(clientVersion) != "" || semver.Prerelease(serverVersion) != "" {
		if serverProtocolVersion != clientProtocolVersion {
			return false, fmt.Sprintf(
				"protocol prereleases must match exactly: client=%s server=%s",
				clientProtocolVersion,
				serverProtocolVersion,
			)
		}
		return true, fmt.Sprintf("protocolVersion=%s", serverProtocolVersion)
	}
	if semver.Major(clientVersion) != semver.Major(serverVersion) {
		return false, fmt.Sprintf(
			"protocol major mismatch: client=%s server=%s",
			clientProtocolVersion,
			serverProtocolVersion,
		)
	}
	clientMinor := semver.MajorMinor(clientVersion) + ".0"
	serverMinor := semver.MajorMinor(serverVersion) + ".0"
	if semver.Compare(serverMinor, clientMinor) < 0 {
		return false, fmt.Sprintf(
			"server protocol %s is older than client requirement %s",
			serverProtocolVersion,
			clientProtocolVersion,
		)
	}

	return true, fmt.Sprintf("protocolVersion=%s", serverProtocolVersion)
}

func validProtocolVersion(version string) bool {
	coreVersion := version
	if suffixIndex := strings.IndexAny(coreVersion, "-+"); suffixIndex >= 0 {
		coreVersion = coreVersion[:suffixIndex]
	}
	return strings.Count(coreVersion, ".") == 2 && semver.IsValid("v"+version)
}
