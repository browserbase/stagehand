package stagehand

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"time"
)

const defaultExperimentalBatchTimeout = 30 * time.Second

// ExperimentalBatchOptions controls a trusted JavaScript callback running in the extension worker.
type ExperimentalBatchOptions struct {
	Timeout time.Duration
	Page    *Page
}

// ExperimentalBatch runs trusted JavaScript against the worker-local public Stagehand object model.
func (s *Stagehand) ExperimentalBatch(
	ctx context.Context,
	source string,
	input any,
	result any,
	options ExperimentalBatchOptions,
) error {
	if ctx == nil {
		return errors.New("stagehand callback batch context is required")
	}
	if strings.TrimSpace(source) == "" {
		return errors.New("stagehand callback batch source must be JavaScript")
	}
	if strings.Contains(source, "[native code]") {
		return errors.New("stagehand callback batch source must be serializable JavaScript")
	}
	resultValue := reflect.ValueOf(result)
	if result == nil || resultValue.Kind() != reflect.Pointer || resultValue.IsNil() {
		return errors.New("stagehand callback batch result must be a non-nil pointer")
	}
	timeout := options.Timeout
	if timeout == 0 {
		timeout = defaultExperimentalBatchTimeout
	}
	if timeout < time.Millisecond {
		return errors.New("stagehand callback batch timeout must be at least one millisecond")
	}
	rpc, err := s.connectedProtocol()
	if err != nil {
		return err
	}
	pageID := ""
	if options.Page != nil {
		pageID = options.Page.PageID()
	}
	runner, ok := rpc.(interface {
		experimentalBatch(context.Context, string, any, string, time.Duration, any) error
	})
	if !ok {
		return errors.New("the connected Stagehand runtime does not support callback batches")
	}
	return runner.experimentalBatch(ctx, source, input, pageID, timeout, result)
}
