# frozen_string_literal: true

module Stagehand
  class StagehandError < StandardError; end

  # A JSON-RPC error response from the Stagehand runtime.
  class RPCError < StagehandError
    attr_reader :code, :data

    def initialize(message, code:, data: nil)
      super(message)
      @code = code
      @data = data
    end
  end

  class CDPError < StagehandError
    attr_reader :method, :code, :data

    def initialize(message, method: nil, code: nil, data: nil)
      super(message)
      @method = method
      @code = code
      @data = data
    end
  end

  class CDPConnectionClosedError < StagehandError
    def initialize(message = "CDP connection closed")
      super
    end
  end

  class WireError < StagehandError; end

  class BrowserbaseSessionError < StagehandError; end

  class TimeoutError < StagehandError; end
end
