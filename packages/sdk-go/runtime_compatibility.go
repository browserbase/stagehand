package stagehand

import (
	"bytes"
	"encoding/json"
	"fmt"
)

const (
	stagehandRuntimeName   = "stagehand"
	stagehandSDKClientName = "stagehand-sdk-go"
	stagehandSDKVersion    = "4.0.0"
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

	var protocolVersion int
	if err := json.Unmarshal(marker["protocolVersion"], &protocolVersion); err != nil {
		return false, fmt.Sprintf(
			"protocolVersion=%s",
			rawJSONDescription(marker["protocolVersion"]),
		)
	}
	if protocolVersion < stagehandProtocolVersion {
		return false, fmt.Sprintf(
			"protocolVersion=%d below %d",
			protocolVersion,
			stagehandProtocolVersion,
		)
	}
	if protocolVersion > stagehandProtocolVersion {
		return false, fmt.Sprintf(
			"protocolVersion=%d above %d",
			protocolVersion,
			stagehandProtocolVersion,
		)
	}

	return true, fmt.Sprintf("protocolVersion=%d", protocolVersion)
}
