package stagehand

import (
	"context"
	"encoding/json"
	"sync/atomic"
	"testing"
	"testing/synctest"
)

func TestPageSubscriptionCloseDropsQueuedNotifications(t *testing.T) {
	for _, event := range []PageSubscriptionEventName{
		PageSubscriptionEventNameConsole,
		PageSubscriptionEventNameToolsadded,
		PageSubscriptionEventNameToolsremoved,
	} {
		t.Run(string(event), func(t *testing.T) {
			synctest.Test(t, func(t *testing.T) {
				client := acknowledgingNotificationClient(t)
				page := &Page{rpc: client, ref: PageRef{PageID: "page-1"}}
				started := make(chan struct{})
				release := make(chan struct{})
				var calls atomic.Int32
				listener := func() {
					if calls.Add(1) == 1 {
						close(started)
						<-release
					}
				}
				var subscription *CDPSubscription
				var err error
				switch event {
				case PageSubscriptionEventNameConsole:
					subscription, err = page.On(context.Background(), PageEventNameConsole, func(PageCDPEvent) { listener() })
				case PageSubscriptionEventNameToolsadded:
					subscription, err = page.OnToolsAdded(context.Background(), func([]*WebMCPTool) { listener() })
				case PageSubscriptionEventNameToolsremoved:
					subscription, err = page.OnToolsRemoved(context.Background(), func([]WebMCPToolIdentity) { listener() })
				}
				if err != nil {
					t.Fatalf("subscribe: %v", err)
				}
				method, notification := pageNotificationForLifecycle(t, event, subscription.subscriptionID)
				client.receiveNotification(method, notification)
				<-started
				client.receiveNotification(method, notification)
				if err := subscription.Close(context.Background()); err != nil {
					t.Fatalf("unsubscribe while listener is busy: %v", err)
				}
				close(release)
				synctest.Wait()
				if got := calls.Load(); got != 1 {
					t.Fatalf("listener calls after successful unsubscribe = %d, want 1; queued callback ran after Close returned", got)
				}
			})
		})
	}
}

func TestRPCClientRemovalDropsAlreadyDequeuedDeliveries(t *testing.T) {
	for _, action := range []string{"remove", "shutdown"} {
		t.Run(action, func(t *testing.T) {
			synctest.Test(t, func(t *testing.T) {
				client := newTestRPCClient(t, newQueueRPCTransport())
				started := make(chan struct{})
				release := make(chan struct{})
				client.onNotification("stagehand.log", func(StagehandLog) {
					close(started)
					<-release
				})
				var calls atomic.Int32
				remove := client.onNotification("stagehand.log", func(StagehandLog) { calls.Add(1) })
				client.receiveNotification("stagehand.log", json.RawMessage(`{"level":"info","message":"queued","data":{}}`))
				<-started
				if action == "shutdown" {
					if err := client.close(); err != nil {
						t.Fatalf("close while listener is busy: %v", err)
					}
				} else {
					remove()
				}
				close(release)
				synctest.Wait()
				if got := calls.Load(); got != 0 {
					t.Fatalf("revoked handler calls = %d, want 0; dequeued group retained a stale callback", got)
				}
			})
		})
	}
}

func TestRPCClientListenerCanRemoveItselfWithoutBlockingOtherListeners(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		client := newTestRPCClient(t, newQueueRPCTransport())
		started := make(chan struct{})
		release := make(chan struct{})
		var calls, otherCalls atomic.Int32
		var remove func()
		remove = client.onNotification("stagehand.log", func(StagehandLog) {
			if calls.Add(1) == 1 {
				close(started)
				<-release
			}
			remove()
		})
		client.onNotification("stagehand.log", func(StagehandLog) { otherCalls.Add(1) })
		client.receiveNotification("stagehand.log", json.RawMessage(`{"level":"info","message":"queued","data":{}}`))
		<-started
		client.receiveNotification("stagehand.log", json.RawMessage(`{"level":"info","message":"queued","data":{}}`))
		close(release)
		synctest.Wait()
		if got := calls.Load(); got != 1 {
			t.Fatalf("self-removed listener calls = %d, want 1", got)
		}
		if got := otherCalls.Load(); got != 2 {
			t.Fatalf("independent listener calls = %d, want 2", got)
		}
	})
}

// --- Fixture helpers: keep runtime acknowledgements and event shapes out of the scheduling tests. ---

// acknowledgingNotificationClient lets subscription RPCs finish while a callback is deliberately blocked.
func acknowledgingNotificationClient(t *testing.T) *rpcClient {
	t.Helper()
	transport := newQueueRPCTransport()
	transport.sendHook = func(message json.RawMessage) {
		var request rpcRequestEnvelope
		if err := json.Unmarshal(message, &request); err != nil {
			t.Fatalf("decode outbound request: %v", err)
		}
		response, err := json.Marshal(rpcSuccessEnvelope{
			JSONRPC: jsonRPCVersion, ID: request.ID, Result: json.RawMessage(`{"ok":true}`),
		})
		if err != nil {
			t.Fatalf("encode runtime acknowledgement: %v", err)
		}
		transport.incoming <- rpcTransportReceive{message: response}
	}
	return newTestRPCClient(t, transport)
}

func pageNotificationForLifecycle(t *testing.T, event PageSubscriptionEventName, subscriptionID string) (string, json.RawMessage) {
	t.Helper()
	method := "page.event"
	var value any
	switch event {
	case PageSubscriptionEventNameConsole:
		method = "page.cdp_event"
		value = PageCDPEventNotification{
			SubscriptionID: subscriptionID,
			Event: PageCDPEvent{
				PageID: "page-1", SessionID: "session-1", TargetID: "target-1",
				Method: "Runtime.consoleAPICalled", Params: PageCDPEventParams{},
			},
		}
	case PageSubscriptionEventNameToolsadded:
		value = NewPageToolsAddedNotification(PageToolsAddedNotification{
			SubscriptionID: subscriptionID, PageID: "page-1", SessionID: "session-1", TargetID: "target-1", Tools: []WebMCPToolDescriptor{},
		})
	case PageSubscriptionEventNameToolsremoved:
		value = NewPageToolsRemovedNotification(PageToolsRemovedNotification{
			SubscriptionID: subscriptionID, PageID: "page-1", SessionID: "session-1", TargetID: "target-1", Tools: []WebMCPToolIdentity{},
		})
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("encode page notification: %v", err)
	}
	return method, encoded
}

// --- End fixture helpers. ---
