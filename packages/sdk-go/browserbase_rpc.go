package stagehand

import (
	"context"
	"errors"
	"sync"
)

// registerBrowserbaseTransport installs handlers on an existing connection.
// Disposal waits for owned HTTP work without closing the shared RPC connection.
func registerBrowserbaseTransport(client *rpcClient, connection *browserbaseConnection) func() {
	executor := newBrowserbaseHTTPExecutor(connection)
	registrationContext, cancelRegistration := context.WithCancel(client.ctx)
	var mu sync.Mutex
	var work sync.WaitGroup
	pending := make(map[uint64]context.CancelCauseFunc)

	handler := newRequestHandler(executor.execute)
	handler.replyContext = registrationContext
	handler.prepare = func(ctx context.Context, id uint64) (context.Context, func(), error) {
		mu.Lock()
		defer mu.Unlock()
		if registrationContext.Err() != nil {
			return nil, nil, errors.New("Browserbase transport is disposed")
		}
		if _, exists := pending[id]; exists {
			return nil, nil, errors.New("Browserbase request ID is already in use")
		}
		ctx, cancel := context.WithCancelCause(ctx)
		pending[id] = cancel
		work.Add(1)
		return ctx, func() {
			mu.Lock()
			delete(pending, id)
			mu.Unlock()
			cancel(nil)
			work.Done()
		}, nil
	}
	removeRequest := client.onRequest("browserbase.request", handler)
	removeCancel := registerControlNotification(client, "browserbase.cancel", func(params BrowserbaseCancelParams) {
		var cause error
		switch params.Reason {
		case BrowserbaseCancelParamsReasonCancelled:
			cause = context.Canceled
		case BrowserbaseCancelParamsReasonTimeout:
			cause = context.DeadlineExceeded
		default:
			return
		}
		mu.Lock()
		defer mu.Unlock()
		if cancel := pending[uint64(params.RequestID)]; cancel != nil {
			cancel(cause)
		}
	})

	var once sync.Once
	dispose := func() {
		once.Do(func() {
			// Close admission before waiting, so no new work can join the group.
			mu.Lock()
			cancelRegistration()
			for _, cancel := range pending {
				cancel(nil)
			}
			mu.Unlock()
			removeRequest()
			removeCancel()
			work.Wait()
			executor.close()
		})
	}
	stop := context.AfterFunc(client.ctx, dispose)
	return func() {
		stop()
		dispose()
	}
}

func (client *rpcClient) registerBrowserbaseTransport(connection *browserbaseConnection) func() {
	return registerBrowserbaseTransport(client, connection)
}
