package stagehand

import (
	"time"
)

const (
	defaultExperimentalBatchTimeout         = 30 * time.Second
	maxExperimentalBatchTimeoutMilliseconds = int64(2_147_483_647 - 10_000)
)

// ExperimentalBatchOptions controls a trusted JavaScript callback running in the extension worker.
type ExperimentalBatchOptions struct {
	Timeout time.Duration
	Page    *Page
}
