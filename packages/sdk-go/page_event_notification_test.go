package stagehand

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestPageEventNotificationRoundTrip(t *testing.T) {
	t.Parallel()
	for _, event := range []string{"toolsadded", "toolsremoved"} {
		t.Run(event, func(t *testing.T) {
			tool := map[string]any{"name": "search", "frame_id": "child-frame"}
			if event == "toolsadded" {
				tool["description"] = "Search"
				tool["input_schema"] = map[string]any{"properties": map[string]any{"queryText": map[string]any{"type": "string"}}}
			}
			input := map[string]any{
				"subscription_id": "subscription-1", "page_id": "page-1",
				"session_id": "session-1", "target_id": "target-1", "event": event,
				"tools": []any{tool},
			}
			encoded, err := json.Marshal(input)
			if err != nil {
				t.Fatal(err)
			}
			var notification PageEventNotification
			if err := json.Unmarshal(encoded, &notification); err != nil {
				t.Fatal(err)
			}
			if event == "toolsadded" {
				added, ok := notification.AsToolsAdded()
				if !ok || added.Tools[0].FrameID != "child-frame" {
					t.Fatal("wrong added payload")
				}
			} else {
				removed, ok := notification.AsToolsRemoved()
				if !ok || removed.Tools[0].Name != "search" {
					t.Fatal("wrong removed payload")
				}
			}
			output, err := json.Marshal(notification)
			if err != nil {
				t.Fatal(err)
			}
			var decoded map[string]any
			if err := json.Unmarshal(output, &decoded); err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(input, decoded) {
				t.Fatalf("round trip changed payload: %s", output)
			}
		})
	}
}

func TestPageEventNotificationRejectsMismatchedPayload(t *testing.T) {
	t.Parallel()
	for _, input := range []string{
		`{"event":"unknown"}`,
		`{"event":"toolsadded"}`,
		`{"subscription_id":"s","page_id":"p","session_id":"s","target_id":"t","event":"toolsadded","tools":[{"name":"search","frame_id":"f"}]}`,
		`{"subscription_id":"s","page_id":"p","session_id":"s","target_id":"t","event":"toolsremoved","tools":[{"name":"search","frame_id":"f","description":"Search"}]}`,
	} {
		var notification PageEventNotification
		if err := json.Unmarshal([]byte(input), &notification); err == nil {
			t.Fatalf("accepted invalid notification: %s", input)
		}
	}
}
