# frozen_string_literal: true

require "json"
require "opentelemetry"
require "set"

require_relative "errors"
require_relative "wire"
require_relative "generated/models"

module Stagehand
  # JSON-RPC 2.0 client over a Stagehand transport (the CDP client). Port of
  # packages/sdk-python/src/stagehand/rpc_client.py onto two background
  # threads: a reader that routes responses to per-request queues, and a
  # dispatcher that runs inbound work (server->client requests such as
  # llm.generate, and notification listeners). Handlers and listeners run on
  # the dispatcher thread and may issue RPC calls themselves; inbound work is
  # processed one item at a time, so a slow handler delays later inbound
  # requests and notifications (Python runs these as concurrent tasks).
  class RPCClient
    MAX_REQUEST_ID = 9_007_199_254_740_991
    MAX_PENDING_NOTIFICATIONS = 100
    RPC_RESPONSE_GRACE_MS = 10_000

    DEFAULT_OPERATION_TIMEOUT_MS = {
      "page.goto" => 15_000,
      "page.reload" => 15_000,
      "page.go_back" => 15_000,
      "page.go_forward" => 15_000,
      "page.wait_for_load_state" => 15_000,
      "page.wait_for_selector" => 30_000,
      "page.webmcp_tools" => 1_000,
    }.freeze

    # These operations had no v3 deadline. Keep the server as the owner of
    # their lifetime instead of turning the grace period into a 10s ceiling.
    UNBOUNDED_BY_DEFAULT_METHODS = %w[
      stagehand.init stagehand.close stagehand.act stagehand.extract stagehand.observe
      context.new_page context.close context.add_init_script context.set_extra_http_headers
      context.get_domain_policy context.set_domain_policy context.cookies context.add_cookies
      context.clear_cookies context.clipboard_read_text context.clipboard_write_text
      context.clipboard_clear context.clipboard_paste context.clipboard_copy context.clipboard_cut
      page.close page.evaluate page.screenshot page.snapshot page.webmcp_invocation_result
    ].to_set.freeze

    OPTIONS_TIMEOUT_METHODS = %w[
      stagehand.act stagehand.extract stagehand.observe stagehand.callback_batch
      page.goto page.reload page.go_back page.go_forward page.screenshot
      page.wait_for_selector page.webmcp_tools page.webmcp_invocation_result
    ].to_set.freeze

    REQUEST_KEYS = %w[jsonrpc id method params traceparent tracestate].freeze

    TRACE_CONTEXT_PROPAGATOR = OpenTelemetry::Trace::Propagation::TraceContext.text_map_propagator
    NOTIFICATION_KEYS = %w[jsonrpc method params].freeze

    def initialize(transport)
      @transport = transport
      @next_request_id = 1
      @state_mutex = Mutex.new
      @pending = {}
      @request_handlers = {}
      @notification_listeners = Hash.new { |hash, key| hash[key] = [] }
      @pending_notifications = []
      @inbound = Thread::Queue.new
      @closed = false
      @close_reason = nil
      @dispatcher = Thread.new { dispatch_loop }
      @dispatcher.name = "stagehand-rpc-dispatcher"
      @reader = Thread.new { read_loop }
      @reader.name = "stagehand-rpc-reader"
    end

    def browser_web_socket_debugger_url
      value = @transport.respond_to?(:web_socket_debugger_url) ? @transport.web_socket_debugger_url : nil
      value.is_a?(String) ? value : nil
    end

    def closed?
      @closed
    end

    # Sends one request and blocks for its result, decoded through the wire
    # descriptor (a Models::DEFS name, class, or compound descriptor).
    def send(method, params, result_descriptor)
      raise StagehandError, "RPC client is closed" if @closed

      wire_params = Wire.encode(params.is_a?(Wire::Model) ? params : params.to_h)
      queue = Thread::Queue.new
      request_id = @state_mutex.synchronize do
        id = @next_request_id
        @next_request_id += 1
        @pending[id] = queue
        id
      end

      request = { "jsonrpc" => "2.0", "id" => request_id, "method" => method, "params" => wire_params }
      # W3C trace context rides on the request envelope, like the sibling
      # SDKs (the direct propagator, independent of any configured SDK).
      TRACE_CONTEXT_PROPAGATOR.inject(request)
      timeout = self.class.response_timeout_seconds(method, wire_params)
      begin
        @transport.send(request)
        outcome = queue.pop(timeout: timeout)
        raise Stagehand::TimeoutError, "RPC response timed out: #{method}" if outcome.nil? && !timeout.nil?
        raise outcome if outcome.is_a?(Exception)
        Wire.decode(outcome.fetch(:result), result_descriptor)
      ensure
        @state_mutex.synchronize { @pending.delete(request_id) }
      end
    end

    # Registers the handler for an inbound server->client request (e.g.
    # llm.generate). Params arrive decoded via Models::METHODS; the handler's
    # return value (a wire model or Hash matching the result definition) is
    # sent back as the JSON-RPC result. The handler runs on the dispatcher
    # thread and may issue RPC calls. Returns a proc that removes the handler
    # (a no-op if another handler replaced it in the meantime).
    def on_request(method, &handler)
      raise StagehandError, "RPC client is closed" if @closed
      raise ArgumentError, "a handler block is required" if handler.nil?

      token = Object.new
      @state_mutex.synchronize { @request_handlers[method] = { token: token, handler: handler } }
      lambda do
        @state_mutex.synchronize do
          registered = @request_handlers[method]
          @request_handlers.delete(method) if registered && registered[:token].equal?(token)
        end
      end
    end

    # Registers a listener for a server notification. Params are decoded via
    # Models::NOTIFICATIONS when the method is a known notification. Listeners
    # run on the dispatcher thread (never the caller's), so a notification
    # buffered before registration is also replayed asynchronously. Returns a
    # proc that removes the listener.
    def on_notification(method, &listener)
      raise StagehandError, "RPC client is closed" if @closed
      raise ArgumentError, "a listener block is required" if listener.nil?

      replayable = @state_mutex.synchronize do
        @notification_listeners[method] << listener
        buffered = @pending_notifications.select { |entry| entry.fetch("method") == method }
        @pending_notifications.reject! { |entry| entry.fetch("method") == method }
        buffered
      end
      replayable.each { |entry| @inbound << [:notification, method, entry["params"], [listener]] }

      lambda do
        @state_mutex.synchronize do
          listeners = @notification_listeners[method]
          listeners.delete(listener)
          @notification_listeners.delete(method) if listeners.empty?
        end
      end
    end

    def close(reason = nil, close_transport: true)
      @state_mutex.synchronize do
        return if @closed
        @closed = true
        @close_reason = reason || StagehandError.new("RPC client closed")
        @request_handlers.clear
        @notification_listeners.clear
        @pending_notifications.clear
        @pending.each_value { |queue| queue << @close_reason }
        @pending.clear
      end
      @inbound << :close
      @transport.close if close_transport
      unless Thread.current == @reader
        # The real transport unblocks the reader on close; the kill is a
        # backstop for transports that cannot (it is parked in receive).
        @reader.kill unless @reader.join(2)
      end
      unless Thread.current == @dispatcher
        # The kill is a backstop for a handler stuck in slow user code.
        @dispatcher.kill unless @dispatcher.join(2)
      end
      nil
    end

    class << self
      def response_timeout_seconds(method, wire_params)
        operation_timeout_ms =
          if OPTIONS_TIMEOUT_METHODS.include?(method)
            numeric(wire_params.is_a?(Hash) ? wire_params.dig("options", "timeout") : nil)
          elsif method == "page.wait_for_load_state"
            numeric(wire_params.is_a?(Hash) ? wire_params["timeout"] : nil)
          elsif method == "page.wait_for_timeout"
            numeric(wire_params.is_a?(Hash) ? wire_params["ms"] : nil)
          end

        return (RPC_RESPONSE_GRACE_MS + [0, operation_timeout_ms].max) / 1_000.0 unless operation_timeout_ms.nil?

        default_timeout_ms = DEFAULT_OPERATION_TIMEOUT_MS[method]
        return (RPC_RESPONSE_GRACE_MS + default_timeout_ms) / 1_000.0 unless default_timeout_ms.nil?

        return nil if UNBOUNDED_BY_DEFAULT_METHODS.include?(method) || method.start_with?("locator.")

        RPC_RESPONSE_GRACE_MS / 1_000.0
      end

      def valid_request_id?(value)
        value.is_a?(Integer) && value >= 0 && value <= MAX_REQUEST_ID
      end

      private

      def numeric(value)
        value.is_a?(Numeric) && !value.is_a?(TrueClass) && !value.is_a?(FalseClass) ? value : nil
      end
    end

    private

    def read_loop
      loop do
        break if @closed
        receive(@transport.receive)
      end
    rescue Exception => error
      close(error) unless @closed
    end

    # Also the seam the unit tests drive directly.
    public def receive(raw)
      message =
        if raw.is_a?(String)
          begin
            JSON.parse(raw)
          rescue JSON::ParserError
            send_error(nil, -32_700, "Parse error")
            return
          end
        else
          raw
        end

      unless message.is_a?(Hash)
        send_error(nil, -32_600, "Invalid request")
        return
      end

      if message.key?("result") || message.key?("error")
        receive_response(message)
      elsif message.key?("method") && !message.key?("id")
        receive_notification(message)
      else
        receive_request(message)
      end
    end

    def receive_response(message)
      valid =
        message["jsonrpc"] == "2.0" &&
        (message.keys - %w[jsonrpc id result error]).empty? &&
        (message.key?("result") ^ message.key?("error"))
      valid &&= self.class.valid_request_id?(message["id"]) || (message.key?("error") && message["id"].nil?)
      if message.key?("error")
        error = message["error"]
        valid &&= error.is_a?(Hash) && (error.keys - %w[code message data]).empty? &&
                  error["code"].is_a?(Integer) && error["message"].is_a?(String)
      end
      unless valid
        close(StagehandError.new("Invalid JSON-RPC response"))
        return
      end

      queue = @state_mutex.synchronize { @pending.delete(message["id"]) }
      return if queue.nil?

      if message.key?("error")
        error = message["error"]
        queue << RPCError.new(error["message"], code: error["code"], data: error["data"])
      else
        queue << { result: message["result"] }
      end
    end

    def receive_notification(message)
      return unless message["jsonrpc"] == "2.0" &&
                    (message.keys - NOTIFICATION_KEYS).empty? &&
                    message["method"].is_a?(String)

      method = message["method"]
      listeners = @state_mutex.synchronize do
        registered = @notification_listeners[method]
        if registered.empty?
          @notification_listeners.delete(method)
          @pending_notifications.shift if @pending_notifications.size == MAX_PENDING_NOTIFICATIONS
          @pending_notifications << message
          nil
        else
          registered.dup
        end
      end
      @inbound << [:notification, method, message["params"], listeners] if listeners
    end

    def dispatch_loop
      loop do
        entry = @inbound.pop
        break if entry == :close
        kind, *rest = entry
        case kind
        when :notification then dispatch_notification(*rest)
        when :request then handle_request(rest.first)
        end
      end
    rescue Exception => error
      close(error) unless @closed
    end

    def dispatch_notification(method, params, listeners)
      entry = Models::NOTIFICATIONS[method]
      decoded =
        begin
          entry ? Wire.decode(params, entry[:params]) : params
        rescue WireError
          return
        end
      listeners.each do |listener|
        listener.call(decoded)
      rescue StandardError => error
        warn "[stagehand] ERROR notification listener failed: #{error.message}"
      end
    end

    def receive_request(message)
      valid =
        message["jsonrpc"] == "2.0" &&
        (message.keys - REQUEST_KEYS).empty? &&
        message["method"].is_a?(String) &&
        self.class.valid_request_id?(message["id"])
      unless valid
        request_id = message["id"]
        send_error(self.class.valid_request_id?(request_id) ? request_id : nil, -32_600, "Invalid request")
        return
      end

      @inbound << [:request, message]
    end

    # Runs on the dispatcher thread: decode params, run the registered
    # handler, validate its result against the method's wire definition, and
    # answer. Errors map to JSON-RPC codes the same way the Python SDK does.
    def handle_request(message)
      request_id = message["id"]
      registered = @state_mutex.synchronize { @request_handlers[message["method"]] }
      if registered.nil?
        send_error(request_id, -32_601, "Method not found")
        return
      end

      entry = Models::METHODS[message["method"]]
      params =
        begin
          entry ? Wire.decode(message["params"], entry[:params]) : message["params"]
        rescue WireError
          send_error(request_id, -32_602, "Invalid params")
          return
        end

      result =
        begin
          registered[:handler].call(params)
        rescue StandardError => error
          send_error(request_id, -32_603, error.message, { "name" => error.class.name })
          return
        end

      wire_result =
        begin
          encoded = Wire.encode(result)
          # Round-trip through the result definition: strict decode raises
          # when the handler's result does not satisfy the wire schema.
          Wire.decode(encoded, entry[:result]) if entry
          encoded
        rescue StandardError
          send_error(request_id, -32_603, "Internal error")
          return
        end

      begin
        @transport.send({ "jsonrpc" => "2.0", "id" => request_id, "result" => wire_result })
      rescue StandardError
        nil
      end
    end

    def send_error(request_id, code, message, data = nil)
      error = { "code" => code, "message" => message }
      error["data"] = data unless data.nil?
      @transport.send({ "jsonrpc" => "2.0", "id" => request_id, "error" => error })
    rescue StandardError
      nil
    end
  end
end
