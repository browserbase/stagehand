package stagehand

import (
	"context"
	"encoding/json"
	"os"
	"testing"
)

func TestBrowserbaseConnectionSharedEndpoints(t *testing.T) {
	data, err := os.ReadFile("../../tests/fixtures/browserbase-transport.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures struct {
		Connection struct {
			APIKey    string `json:"apiKey"`
			SessionID string `json:"sessionId"`
		} `json:"connection"`
		Endpoints []struct {
			Name     string             `json:"name"`
			Region   *BrowserbaseRegion `json:"region"`
			APIURL   *string            `json:"apiUrl"`
			Expected string             `json:"expected"`
		} `json:"endpoints"`
	}
	if err := json.Unmarshal(data, &fixtures); err != nil {
		t.Fatal(err)
	}
	if len(fixtures.Endpoints) == 0 {
		t.Fatal("missing endpoint fixtures")
	}
	for _, fixture := range fixtures.Endpoints {
		t.Run(fixture.Name, func(t *testing.T) {
			connection, err := resolveBrowserbaseConnection(CreateOptions{
				APIKey: &fixtures.Connection.APIKey, APIURL: fixture.APIURL,
			}, claimedBrowser{workerBrowser: &BrowserSessionMetadata{
				SessionID: fixtures.Connection.SessionID, Region: fixture.Region,
			}})
			if err != nil {
				t.Fatal(err)
			}
			want := browserbaseConnection{
				apiKey: fixtures.Connection.APIKey, apiURL: fixture.Expected, sessionID: fixtures.Connection.SessionID,
			}
			if connection == nil || *connection != want {
				t.Fatalf("connection = %#v, want %#v", connection, want)
			}
		})
	}
}

func TestBrowserbaseConnectionClaimedKeyPrecedence(t *testing.T) {
	for _, constructorKey := range []*string{nil, testPointer("bb-constructor-key")} {
		options := CreateOptions{APIKey: constructorKey, APIURL: testPointer("https://fixture.example/services/")}
		claimed := claimedBrowser{
			workerAPIKey: testPointer("bb-claimed-key"),
			workerBrowser: &BrowserSessionMetadata{
				SessionID: "session", Region: testPointer(BrowserbaseRegionEUCentral1),
			},
		}
		connection, err := resolveBrowserbaseConnection(options, claimed)
		if err != nil {
			t.Fatal(err)
		}
		want := browserbaseConnection{"bb-claimed-key", "https://fixture.example/services/v1", "session"}
		if connection == nil || *connection != want {
			t.Fatalf("connection = %#v, want %#v", connection, want)
		}
		if constructorKey != nil && *constructorKey != "bb-constructor-key" {
			t.Fatal("constructor key changed")
		}
		if *claimed.workerAPIKey != "bb-claimed-key" || *claimed.workerBrowser.Region != BrowserbaseRegionEUCentral1 {
			t.Fatal("claimed metadata changed")
		}
	}
}

func TestBrowserbaseConnectionRequiresKeyAndSession(t *testing.T) {
	for _, test := range []struct {
		name    string
		options CreateOptions
		claimed claimedBrowser
	}{
		{name: "no settings"},
		{name: "constructor key only", options: CreateOptions{APIKey: testPointer("bb-key")}},
		{name: "claimed key only", claimed: claimedBrowser{workerAPIKey: testPointer("bb-key")}},
		{name: "session only", claimed: claimedBrowser{workerBrowser: &BrowserSessionMetadata{SessionID: "session"}}},
		{
			name: "empty constructor key", options: CreateOptions{APIKey: testPointer("")},
			claimed: claimedBrowser{workerBrowser: &BrowserSessionMetadata{SessionID: "session"}},
		},
		{
			name: "empty claimed key overrides constructor", options: CreateOptions{APIKey: testPointer("bb-key")},
			claimed: claimedBrowser{workerAPIKey: testPointer(""), workerBrowser: &BrowserSessionMetadata{SessionID: "session"}},
		},
		{
			name: "empty session", options: CreateOptions{APIKey: testPointer("bb-key")},
			claimed: claimedBrowser{workerBrowser: &BrowserSessionMetadata{}},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			connection, err := resolveBrowserbaseConnection(test.options, test.claimed)
			if err != nil || connection != nil {
				t.Fatalf("connection = %#v, error = %v; want unavailable", connection, err)
			}
		})
	}
}

func TestBrowserbaseConnectionIndependentOfModelAndCache(t *testing.T) {
	for _, test := range []struct {
		name    string
		options CreateOptions
	}{
		{name: "direct model", options: CreateOptions{Model: &ModelConfig{ModelName: "openai/gpt-5", APIKey: testPointer("provider-key")}}},
		{name: "custom model", options: CreateOptions{Generate: func(context.Context, LLMGenerateParams) (LLMGenerateResult, error) {
			t.Fatal("connection resolution called the model callback")
			return LLMGenerateResult{}, nil
		}}},
	} {
		t.Run(test.name, func(t *testing.T) {
			test.options.Cache = testPointer(CacheEnabled(false))
			claimed := claimedBrowser{workerBrowser: &BrowserSessionMetadata{SessionID: "session"}}
			connection, err := resolveBrowserbaseConnection(test.options, claimed)
			if err != nil || connection != nil {
				t.Fatalf("model-only connection = %#v, error = %v", connection, err)
			}
			test.options.APIKey = testPointer("bb-key")
			connection, err = resolveBrowserbaseConnection(test.options, claimed)
			if err != nil {
				t.Fatal(err)
			}
			want := browserbaseConnection{"bb-key", "https://api.stagehand.browserbase.com/v1", "session"}
			if connection == nil || *connection != want {
				t.Fatalf("connection = %#v, want %#v", connection, want)
			}
		})
	}
}

func TestBrowserbaseConnectionSnapshotsCallerValues(t *testing.T) {
	options := CreateOptions{APIKey: testPointer("bb-first"), APIURL: testPointer("https://first.example/")}
	claimed := claimedBrowser{workerBrowser: &BrowserSessionMetadata{SessionID: "first-session"}}
	first, err := resolveBrowserbaseConnection(options, claimed)
	if err != nil {
		t.Fatal(err)
	}
	*options.APIKey = "bb-second"
	*options.APIURL = "https://second.example/"
	claimed.workerAPIKey = testPointer("bb-claimed")
	claimed.workerBrowser.SessionID = "second-session"
	claimed.workerBrowser.Region = testPointer(BrowserbaseRegionUSEast1)
	second, err := resolveBrowserbaseConnection(options, claimed)
	if err != nil {
		t.Fatal(err)
	}
	*claimed.workerAPIKey = "bb-third"
	*claimed.workerBrowser.Region = BrowserbaseRegionEUCentral1
	wantFirst := browserbaseConnection{"bb-first", "https://first.example/v1", "first-session"}
	wantSecond := browserbaseConnection{"bb-claimed", "https://second.example/v1", "second-session"}
	if first == nil || *first != wantFirst || second == nil || *second != wantSecond {
		t.Fatalf("snapshots changed: first = %#v, second = %#v", first, second)
	}
}

func TestBrowserbaseConnectionRejectsUnknownRegion(t *testing.T) {
	connection, err := resolveBrowserbaseConnection(CreateOptions{APIKey: testPointer("bb-key")}, claimedBrowser{
		workerBrowser: &BrowserSessionMetadata{SessionID: "session", Region: testPointer(BrowserbaseRegion("unknown"))},
	})
	if err == nil || connection != nil {
		t.Fatalf("unknown region: connection = %#v, error = %v", connection, err)
	}
}
