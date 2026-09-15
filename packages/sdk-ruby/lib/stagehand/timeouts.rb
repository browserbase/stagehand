# frozen_string_literal: true

require_relative "errors"

module Stagehand
  STAGEHAND_INIT_TIMEOUT_MS = 60_000

  # Monotonic deadline shared across the whole browser-connect / init flow,
  # mirroring the caller-owned 60-second lifecycle in the sibling SDKs.
  class Deadline
    def self.stagehand_init
      new(STAGEHAND_INIT_TIMEOUT_MS / 1_000.0)
    end

    def initialize(seconds)
      @expires_at = now + seconds
    end

    def remaining
      @expires_at - now
    end

    def expired?
      remaining <= 0
    end

    def check!(operation)
      raise Stagehand::TimeoutError, "#{operation} timed out" if expired?
    end

    # Bounds a step timeout by the overall deadline.
    def bound(seconds)
      seconds.nil? ? remaining : [seconds, remaining].min
    end

    private

    def now
      Process.clock_gettime(Process::CLOCK_MONOTONIC)
    end
  end
end
