package stagehand

import (
	"time"
)

const defaultExperimentalBatchTimeout = 30 * time.Second

// ExperimentalBatchOptions controls a trusted JavaScript callback running in the extension worker.
type ExperimentalBatchOptions struct {
	Timeout time.Duration
	Page    *Page
}
