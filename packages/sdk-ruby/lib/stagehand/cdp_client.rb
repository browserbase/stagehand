# frozen_string_literal: true

require "json"
require "net/http"
require "uri"

require_relative "errors"
require_relative "timeouts"
require_relative "web_socket"
require_relative "generated/protocol_version"

module Stagehand
  # CDP transport to the Stagehand extension service worker. Port of
  # packages/sdk-python/src/stagehand/cdp_client.py onto a background reader
  # thread: outbound JSON-RPC messages are double-JSON-encoded into
  # Runtime.evaluate calls, inbound ones arrive as Runtime.bindingCalled
  # events on the attached service-worker session.
  class CDPClient
    SEND_TO_HOST_BINDING = "__stagehandSendToHost"
    RUNTIME_NAME = "stagehand"
    STAGEHAND_EXTENSION_NAME = "Stagehand Runtime"
    DEFAULT_COMMAND_TIMEOUT_SECONDS = 60

    # Constant on purpose: the sibling SDKs evaluate the identical expression,
    # so the implementations cannot drift. All judgement happens client-side.
    RUNTIME_READINESS_EXPRESSION = <<~JS
      (() => ({
        marker: globalThis.__stagehand_runtime ?? null,
        hasReceiver: typeof globalThis.__stagehandReceiveFromHost === "function",
      }))()
    JS

    ServiceWorkerInfo = Data.define(:target_id, :url, :title, :extension_id)

    attr_reader :web_socket_debugger_url

    def self.connect(
      cdp_url:,
      extension_dir: nil,
      extension_id: nil,
      preloaded_extension: false,
      service_worker_url_includes: "service-worker.js",
      deadline: Deadline.stagehand_init
    )
      selected = [extension_dir, extension_id, preloaded_extension ? true : nil].compact
      raise ArgumentError, "Exactly one of extension_dir, extension_id, or preloaded_extension is required" if selected.size != 1

      web_socket_debugger_url = resolve_browser_web_socket_url(cdp_url, deadline)
      socket = WebSocketConnection.new(web_socket_debugger_url)
      client = new(socket, web_socket_debugger_url)
      begin
        client.attach(
          extension_dir: extension_dir,
          extension_id: extension_id,
          preloaded_extension: preloaded_extension,
          service_worker_url_includes: service_worker_url_includes,
          deadline: deadline,
        )
        client
      rescue Exception
        client.close
        raise
      end
    end

    def self.resolve_browser_web_socket_url(cdp_url, deadline)
      return cdp_url if cdp_url.start_with?("ws://", "wss://")

      base_url = cdp_url.sub(%r{/+\z}, "")
      loop do
        deadline.check!("resolving the browser WebSocket URL")
        begin
          uri = URI("#{base_url}/json/version")
          response = Net::HTTP.start(uri.host, uri.port, open_timeout: 2, read_timeout: 2) do |http|
            http.get(uri.request_uri)
          end
          if response.is_a?(Net::HTTPSuccess)
            debugger_url = JSON.parse(response.body)["webSocketDebuggerUrl"]
            return debugger_url if debugger_url.is_a?(String) && !debugger_url.empty?
          end
        rescue SystemCallError, IOError, Net::OpenTimeout, Net::ReadTimeout, JSON::ParserError
          nil
        end
        sleep(0.25)
      end
    end

    def initialize(socket, web_socket_debugger_url)
      @socket = socket
      @web_socket_debugger_url = web_socket_debugger_url
      @next_id = 1
      @id_mutex = Mutex.new
      @pending = {}
      @incoming = Thread::Queue.new
      @session_id = nil
      @service_worker = nil
      @closed = false
      @close_mutex = Mutex.new
      @reader = Thread.new { read_loop }
      @reader.name = "stagehand-cdp-reader"
    end

    def service_worker
      raise StagehandError, "Stagehand service worker is not attached" if @service_worker.nil?
      @service_worker
    end

    def attach(extension_dir:, extension_id:, preloaded_extension:, service_worker_url_includes:, deadline:)
      resolved_extension_id = extension_id
      resolved_extension_id = load_unpacked_extension(extension_dir) if extension_dir
      resolved_extension_id = discover_installed_stagehand_extension_id if preloaded_extension
      raise StagehandError, "Stagehand extension ID was not resolved" if resolved_extension_id.nil?

      worker = wait_for_service_worker(resolved_extension_id, service_worker_url_includes, deadline)
      attached = send_command("Target.attachToTarget", { "targetId" => worker.target_id, "flatten" => true })
      session_id = required_string(attached, "sessionId", "Target.attachToTarget")
      @session_id = session_id
      @service_worker = worker

      begin
        send_command("Runtime.enable", {}, session_id: session_id)
      rescue StagehandError
        nil
      end
      send_command("Runtime.addBinding", { "name" => SEND_TO_HOST_BINDING }, session_id: session_id)
      wait_for_runtime_receiver(session_id, deadline)
      nil
    end

    # RPC transport: deliver one JSON-RPC message to the service worker.
    def send(message)
      raise StagehandError, "CDP client is closed" if @closed
      raise StagehandError, "Stagehand service worker is not attached" if @session_id.nil?

      callback_source = self.class.callback_source_from_message(message)
      expression =
        if callback_source.nil?
          "void globalThis.__stagehandReceiveFromHost(#{JSON.generate(JSON.generate(message))}); true"
        else
          self.class.callback_batch_expression(message, callback_source)
        end
      evaluated = send_command(
        "Runtime.evaluate",
        { "expression" => expression, "awaitPromise" => false, "returnByValue" => true },
        session_id: @session_id,
      )
      exception_details = evaluated["exceptionDetails"]
      return unless exception_details.is_a?(Hash)

      exception = exception_details["exception"]
      description = exception.is_a?(Hash) ? exception["description"] : nil
      raise StagehandError, (description || exception_details["text"] || "Stagehand service worker rejected an RPC message").to_s
    end

    # RPC transport: block until the next inbound JSON-RPC payload string.
    def receive
      message = @incoming.pop
      raise message if message.is_a?(Exception)
      message
    end

    def send_command(method, params = {}, session_id: nil, timeout: DEFAULT_COMMAND_TIMEOUT_SECONDS)
      raise StagehandError, "CDP client is closed" if @closed

      queue = Thread::Queue.new
      command_id = @id_mutex.synchronize do
        id = @next_id
        @next_id += 1
        @pending[id] = [method, queue]
        id
      end
      message = { "id" => command_id, "method" => method, "params" => params }
      message["sessionId"] = session_id unless session_id.nil?

      begin
        @socket.send_text(JSON.generate(message))
        outcome = queue.pop(timeout: timeout)
        raise Stagehand::TimeoutError, "CDP command timed out: #{method}" if outcome.nil?
        raise outcome if outcome.is_a?(Exception)
        outcome
      ensure
        @id_mutex.synchronize { @pending.delete(command_id) }
      end
    end

    def close
      @close_mutex.synchronize do
        return if @closed
        @closed = true
      end
      reason = CDPConnectionClosedError.new("CDP client closed")
      reject_pending(reason)
      @incoming << reason
      @socket.close
      unless Thread.current == @reader
        @reader.kill unless @reader.join(2)
      end
      nil
    end

    private

    def read_loop
      loop do
        break if @closed
        handle_message(@socket.recv)
      end
    rescue Exception => error
      return if @closed
      @close_mutex.synchronize { @closed = true }
      wrapped = error.is_a?(CDPConnectionClosedError) ? error : CDPConnectionClosedError.new("CDP connection closed: #{error.message}")
      reject_pending(wrapped)
      @incoming << wrapped
      @socket.close
    end

    def handle_message(data)
      message = JSON.parse(data)
      raise CDPConnectionClosedError, "Invalid CDP message" unless message.is_a?(Hash)

      command_id = message["id"]
      if command_id.is_a?(Integer)
        handle_response(command_id, message)
        return
      end

      return unless message["method"] == "Runtime.bindingCalled" && message["sessionId"] == @session_id
      params = message["params"]
      return unless params.is_a?(Hash) && params["name"] == SEND_TO_HOST_BINDING
      payload = params["payload"]
      return unless payload.is_a?(String) && params["executionContextId"].is_a?(Integer)
      @incoming << payload
    end

    def handle_response(command_id, message)
      method, queue = @id_mutex.synchronize { @pending.delete(command_id) }
      return if queue.nil?

      error = message["error"]
      if error.is_a?(Hash)
        queue << CDPError.new(
          "CDP command failed: #{method}: #{error["message"] || "Unknown error"}",
          method: method,
          code: error["code"],
          data: error["data"],
        )
      else
        result = message["result"]
        queue << (result.is_a?(Hash) ? result : {})
      end
    end

    def reject_pending(error)
      pending = @id_mutex.synchronize do
        entries = @pending.values
        @pending.clear
        entries
      end
      pending.each { |_method, queue| queue << error }
    end

    def load_unpacked_extension(extension_dir)
      loaded =
        begin
          send_command("Extensions.loadUnpacked", { "path" => extension_dir })
        rescue CDPError => error
          if error.code == -32_601 || error.message.downcase.include?("method not found")
            raise StagehandError,
                  "This Chrome build does not support Extensions.loadUnpacked. " \
                  "Launch with --load-extension and connect using extension_id instead."
          end
          raise
        end
      required_string(loaded, "id", "Extensions.loadUnpacked")
    end

    def discover_installed_stagehand_extension_id
      response = send_command("Extensions.getExtensions")
      extensions = response["extensions"]
      raise StagehandError, "Extensions.getExtensions did not return extensions" unless extensions.is_a?(Array)

      installed = extensions.select { |ext| ext.is_a?(Hash) && ext["name"] == STAGEHAND_EXTENSION_NAME }
      enabled = installed.select { |ext| ext["enabled"] == true }
      return enabled.first.fetch("id") if enabled.size == 1
      if enabled.size > 1
        ids = enabled.map { |ext| ext["id"] }.sort.join(", ")
        raise StagehandError, "Multiple enabled Stagehand extensions are installed: #{ids}"
      end
      if installed.any?
        raise StagehandError, "Stagehand extension is installed in the connected browser but is disabled."
      end
      raise StagehandError,
            "Stagehand extension is not installed in the connected browser. " \
            "The extension must be included when the Browserbase session is created."
    end

    def wait_for_service_worker(extension_id, url_includes, deadline)
      started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
      activation_target_id = nil

      begin
        loop do
          deadline.check!("waiting for the Stagehand service worker")
          response = send_command("Target.getTargets")
          targets = response["targetInfos"]
          (targets.is_a?(Array) ? targets : []).each do |target|
            next unless target.is_a?(Hash)
            url = target["url"]
            next unless target["type"] == "service_worker" &&
                        url.is_a?(String) &&
                        url.start_with?("chrome-extension://#{extension_id}/") &&
                        url.include?(url_includes)
            return ServiceWorkerInfo.new(
              target_id: required_string(target, "targetId", "Target.getTargets"),
              title: required_string(target, "title", "Target.getTargets"),
              url: url,
              extension_id: extension_id,
            )
          end

          if activation_target_id.nil? && Process.clock_gettime(Process::CLOCK_MONOTONIC) - started >= 1
            begin
              activation = send_command(
                "Target.createTarget",
                { "url" => "chrome-extension://#{extension_id}/wake-service-worker.html" },
              )
              target_id = activation["targetId"]
              activation_target_id = target_id if target_id.is_a?(String)
            rescue StagehandError
              nil
            end
          end
          sleep(0.1)
        end
      ensure
        if activation_target_id
          close_id = activation_target_id
          Thread.new do
            send_command("Target.closeTarget", { "targetId" => close_id })
          rescue StandardError
            nil
          end
        end
      end
    end

    def wait_for_runtime_receiver(session_id, deadline)
      loop do
        deadline.check!("waiting for the Stagehand runtime")
        begin
          evaluated = send_command(
            "Runtime.evaluate",
            { "expression" => RUNTIME_READINESS_EXPRESSION, "returnByValue" => true },
            session_id: session_id,
          )
          unless evaluated["exceptionDetails"].is_a?(Hash)
            result = evaluated["result"]
            value = result.is_a?(Hash) ? result["value"] : nil
            if value.is_a?(Hash)
              compatible, _detail = self.class.negotiate_runtime(value["marker"])
              return if compatible && value["hasReceiver"] == true
            end
          end
        rescue StagehandError
          nil
        end
        sleep(0.1)
      end
    end

    def required_string(value, key, method)
      result = value[key]
      raise StagehandError, "#{method} did not return #{key}" unless result.is_a?(String) && !result.empty?
      result
    end

    class << self
      # stagehand.callback_batch carries JavaScript that must reach the worker
      # as code, not as a JSON string. Returns the callback source for such
      # messages, nil for every other method.
      def callback_source_from_message(message)
        return nil unless message["method"] == "stagehand.callback_batch"

        params = message["params"]
        source = params.is_a?(Hash) ? params["callback_source"] : nil
        unless source.is_a?(String) && !source.strip.empty?
          raise StagehandError, "Stagehand callback batch request is missing callback_source"
        end
        source
      end

      # The same expression the sibling SDKs evaluate: the JSON-RPC message as
      # a double-encoded string plus the callback as a live function value.
      # __name shims esbuild's helper for transformed sources.
      def callback_batch_expression(message, source)
        serialized_message = JSON.generate(JSON.generate(message))
        "(() => { const __name = (fn, name) => { try { " \
          "Object.defineProperty(fn, 'name', { value: name, configurable: true }); " \
          "} catch {} return fn; }; void globalThis.__stagehandReceiveFromHost(" \
          "#{serialized_message}, { callback: (#{source}) }); return true; })()"
      end

      # Returns [compatible, detail]. Never raises: a malformed marker is just
      # incompatible.
      def negotiate_runtime(marker)
        return [false, "no Stagehand runtime marker"] unless marker.is_a?(Hash)

        server_info = marker["serverInfo"]
        name = server_info.is_a?(Hash) ? server_info["name"] : nil
        return [false, "serverInfo.name=#{name.inspect}"] unless name == RUNTIME_NAME

        protocol_version = marker["protocolVersion"]
        return [false, "protocolVersion=#{protocol_version.inspect}"] unless protocol_version.is_a?(String)
        incompatibility = protocol_compatibility(STAGEHAND_PROTOCOL_VERSION, protocol_version)
        return [false, incompatibility] unless incompatibility.nil?

        [true, "protocolVersion=#{protocol_version}"]
      end

      # Returns nil when compatible, or a human-readable incompatibility.
      def protocol_compatibility(client_version, server_version)
        client = PROTOCOL_SEMVER_PATTERN.match(client_version)
        server = PROTOCOL_SEMVER_PATTERN.match(server_version)
        if client.nil? || server.nil?
          return "invalid protocol version: client=#{client_version.inspect} server=#{server_version.inspect}"
        end
        if client[4] || server[4]
          unless client_version == server_version
            return "protocol prereleases must match exactly: client=#{client_version} server=#{server_version}"
          end
          return nil
        end
        if client[1] != server[1]
          return "protocol major mismatch: client=#{client_version} server=#{server_version}"
        end
        if server[2].to_i < client[2].to_i
          return "server protocol #{server_version} is older than client requirement #{client_version}"
        end
        nil
      end
    end
  end
end
