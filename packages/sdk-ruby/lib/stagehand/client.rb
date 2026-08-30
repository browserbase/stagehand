# frozen_string_literal: true

require "json"

require_relative "errors"
require_relative "browser"
require_relative "browser_context"
require_relative "generated/models"
require_relative "generated/protocol_version"
require_relative "rpc_client"
require_relative "sdk_identity"
require_relative "validation"

module Stagehand
  # The Stagehand client. Walking-skeleton surface: create/close plus the AI
  # primitives act/extract/observe. Port of
  # packages/sdk-python/src/stagehand/stagehand.py.
  class Client
    LOG_LEVEL_PRIORITY = { "debug" => 10, "info" => 20, "warn" => 30, "error" => 40, "off" => Float::INFINITY }.freeze

    class << self
      def create(
        browser:,
        api_key: nil,
        api_url: nil,
        model: nil,
        model_api_key: nil,
        model_headers: nil,
        telemetry: nil,
        system_prompt: nil,
        self_heal: nil,
        dom_settle_timeout_ms: nil,
        cache: nil,
        log_level: "info",
        on_log: nil
      )
        raise ArgumentError, "browser must be created by LocalBrowser or Browserbase" unless browser.is_a?(StagehandBrowser)
        if model.nil? && (model_api_key || model_headers)
          raise ArgumentError, "model connection options require a model name"
        end
        if model.respond_to?(:call) && (model_api_key || model_headers)
          raise ArgumentError, "model connection options cannot be used with an LLM callback"
        end
        unless model.nil? || model.is_a?(String) || model.respond_to?(:call)
          raise ArgumentError, "model must be a model name String or a callable LLM generate handler"
        end
        Validation.nonempty_string!(api_key, "api_key") unless api_key.nil?
        Validation.nonempty_string!(api_url, "api_url") unless api_url.nil?
        Validation.nonempty_string!(model_api_key, "model_api_key") unless model_api_key.nil?
        Validation.string_map!(model_headers, "model_headers") unless model_headers.nil?
        Validation.nonempty_string!(system_prompt, "system_prompt") unless system_prompt.nil?
        Validation.boolean!(self_heal, "self_heal") unless self_heal.nil?
        Validation.positive_integer!(dom_settle_timeout_ms, "dom_settle_timeout_ms") unless dom_settle_timeout_ms.nil?
        telemetry = Validation.telemetry_config(telemetry) unless telemetry.nil?
        cache = Validation.cache_config(cache) unless cache.nil?
        unless LOG_LEVEL_PRIORITY.key?(log_level)
          raise ArgumentError, "log_level must be one of #{LOG_LEVEL_PRIORITY.keys.join(", ")}"
        end

        cdp_client, metadata = browser.__claim
        client = new(
          browser: browser,
          cdp_client: cdp_client,
          worker_init_metadata: metadata,
          api_key: api_key,
          api_url: api_url,
          model: model,
          model_api_key: model_api_key,
          model_headers: model_headers,
          telemetry: telemetry,
          system_prompt: system_prompt,
          self_heal: self_heal,
          dom_settle_timeout_ms: dom_settle_timeout_ms,
          cache: cache,
          log_level: log_level,
          on_log: on_log,
        )
        begin
          client.__initialize_runtime
        rescue Exception
          client.__release_resources
          browser.__release
          raise
        end
        client
      end

      private :new
    end

    attr_reader :browser

    def initialize(browser:, cdp_client:, worker_init_metadata:, **config)
      @browser = browser
      @cdp_client = cdp_client
      @worker_init_metadata = worker_init_metadata
      @config = config
      @rpc_client = nil
      @remove_log_listener = nil
      @remove_client_llm_handler = nil
      @initialized = false
      @close_mutex = Mutex.new
      @closed = false
    end

    def initialized?
      @initialized
    end

    def act(instruction, page: nil, model: nil, variables: nil, timeout: nil,
            locator: nil, ignore_locators: nil, cache: nil)
      page_id = target_page_id(page)
      params = { page_id: page_id, instruction: encode_instruction(instruction) }
      options = call_options(model: model, variables: variables, timeout: timeout, cache: cache,
                             locator: serialize_locator(locator, page_id, "act"),
                             ignore_locators: serialize_locators(ignore_locators, page_id, "act"))
      params[:options] = Models::ActOptions.new(**options) unless options.nil?
      connected_rpc_client.send("stagehand.act", Models::StagehandActParams.new(**params), "ActResult")
    end

    def observe(instruction = nil, page: nil, model: nil, variables: nil, timeout: nil,
                locator: nil, ignore_locators: nil, cache: nil)
      page_id = target_page_id(page)
      params = { page_id: page_id }
      params[:instruction] = instruction unless instruction.nil?
      options = call_options(model: model, variables: variables, timeout: timeout, cache: cache,
                             locator: serialize_locator(locator, page_id, "observe"),
                             ignore_locators: serialize_locators(ignore_locators, page_id, "observe"))
      params[:options] = Models::ObserveOptions.new(**options) unless options.nil?
      connected_rpc_client.send("stagehand.observe", Models::StagehandObserveParams.new(**params), "ObserveResult")
    end

    # schema is a plain JSON Schema Hash; the extracted data comes back as raw
    # JSON matching it. Defaults to { extraction: string }.
    def extract(instruction, schema: nil, page: nil, model: nil, timeout: nil, screenshot: nil,
                locator: nil, ignore_locators: nil, cache: nil)
      page_id = target_page_id(page)
      params = { page_id: page_id, instruction: instruction }
      params[:schema] = schema unless schema.nil?
      options = call_options(model: model, timeout: timeout, screenshot: screenshot, cache: cache,
                             locator: serialize_locator(locator, page_id, "extract"),
                             ignore_locators: serialize_locators(ignore_locators, page_id, "extract"))
      params[:options] = Models::ExtractOptions.new(**options) unless options.nil?
      connected_rpc_client.send("stagehand.extract", Models::StagehandExtractParams.new(**params), "ExtractResult")
    end

    def metrics
      connected_rpc_client.send("stagehand.metrics", Models::EmptyParams.new, "StagehandMetrics")
    end

    UNSET_BATCH_INPUT = Object.new
    private_constant :UNSET_BATCH_INPUT
    MAX_CALLBACK_BATCH_TIMEOUT_MS = 2_147_483_647 - 10_000

    # Runs trusted JavaScript against the worker-local Stagehand object model
    # (the source travels beside, not inside, the JSON-RPC message — see
    # CDPClient.callback_batch_expression). Returns the callback's JSON value.
    def experimental_batch(source, input = UNSET_BATCH_INPUT, timeout: 30_000, page: nil)
      raise ArgumentError, "source must be a non-empty JavaScript string" unless source.is_a?(String) && !source.strip.empty?
      unless timeout.is_a?(Integer) && timeout.positive?
        raise ArgumentError, "timeout must be a positive number of milliseconds"
      end
      raise ArgumentError, "timeout must not exceed #{MAX_CALLBACK_BATCH_TIMEOUT_MS} milliseconds" if timeout > MAX_CALLBACK_BATCH_TIMEOUT_MS

      options = { timeout: timeout }
      options[:page_id] = page.page_id unless page.nil?
      values = { callback_source: source, options: Models::CallbackBatchOptions.new(**options) }
      unless input.equal?(UNSET_BATCH_INPUT)
        assert_json_value(input)
        values[:input] = input
      end
      result = connected_rpc_client.send(
        "stagehand.callback_batch",
        Models::CallbackBatchParams.new(**values),
        "CallbackBatchResult",
      )
      result.value
    end

    def close
      @close_mutex.synchronize do
        return if @closed
        @closed = true
      end
      begin
        if @initialized && @rpc_client && !@rpc_client.closed?
          @rpc_client.send("stagehand.close", Models::EmptyParams.new, "StagehandCloseResult")
        end
      rescue CDPConnectionClosedError, StagehandError
        nil
      ensure
        __release_resources
        @browser.__release
      end
      nil
    end

    # Internal: RPC bring-up + stagehand.init. Public only for Client.create.
    def __initialize_runtime
      rpc_client = RPCClient.new(@cdp_client)
      @rpc_client = rpc_client
      @remove_log_listener = rpc_client.on_notification("stagehand.log") { |log| handle_log(log) }
      if client_llm?
        client_llm = @config[:model]
        @remove_client_llm_handler = rpc_client.on_request("llm.generate") { |params| client_llm.call(params) }
      end
      rpc_client.send("stagehand.init", Models::StagehandInitParams.new(**worker_init_values), "StagehandInitResult")
      @browser.__attach_context(BrowserContext.new(rpc_client))
      @initialized = true
      nil
    end

    def __release_resources
      @remove_client_llm_handler&.call
      @remove_client_llm_handler = nil
      @remove_log_listener&.call
      @remove_log_listener = nil
      rpc_client = @rpc_client
      @rpc_client = nil
      @initialized = false
      # The browser owns the CDP transport; only the RPC layer shuts down here.
      rpc_client&.close(StagehandError.new("Stagehand closed"), close_transport: false)
      nil
    end

    private

    # A callable model (anything responding to #call, e.g. a Proc) is a
    # client-side LLM: the worker sends llm.generate requests back to it.
    def client_llm?
      @config[:model].respond_to?(:call)
    end

    def connected_rpc_client
      unless @initialized && @rpc_client
        raise StagehandError, "Stagehand is unavailable. Create a new instance with Stagehand.create()."
      end
      @rpc_client
    end

    def target_page_id(page)
      return page.page_id unless page.nil?
      active = @browser.context.active_page
      raise StagehandError, "Stagehand has no active page" if active.nil?
      active.page_id
    end

    def encode_instruction(instruction)
      case instruction
      when String, Models::Action, Hash then instruction
      else raise ArgumentError, "instruction must be a String or an Action"
      end
    end

    def call_options(model: nil, variables: nil, timeout: nil, screenshot: nil,
                     locator: nil, ignore_locators: nil, cache: nil)
      values = {}
      values[:model] = model.is_a?(String) ? Models::ModelConfig.new(model_name: model) : model unless model.nil?
      values[:variables] = variables unless variables.nil?
      values[:timeout] = timeout unless timeout.nil?
      values[:screenshot] = screenshot unless screenshot.nil?
      values[:locator] = locator unless locator.nil?
      values[:ignore_locators] = ignore_locators unless ignore_locators.nil?
      values[:cache] = Validation.cache_config(cache) unless cache.nil?
      values.empty? ? nil : values
    end

    # Locator targets must belong to the page the operation runs on (port of
    # Python's _serialize_locator).
    def serialize_locator(locator, page_id, method)
      return nil if locator.nil?
      unless locator.is_a?(Locator) && locator.page_id == page_id
        raise ArgumentError, "#{method}() locator must belong to the target page"
      end
      values = { selector: locator.selector }
      values[:nth] = locator.nth_index unless locator.nth_index.nil?
      Models::Locator.new(**values)
    end

    def serialize_locators(locators, page_id, method)
      return nil if locators.nil?
      locators.map { |locator| serialize_locator(locator, page_id, method) }
    end

    def worker_init_values
      values = {
        protocol_version: STAGEHAND_PROTOCOL_VERSION,
        client_info: Models::ImplementationInfo.new(**STAGEHAND_SDK_CLIENT_INFO.transform_keys(&:to_sym)),
        browser_cdp_url: @cdp_client.web_socket_debugger_url,
        log_level: @config[:log_level],
      }
      values[:api_key] = @worker_init_metadata.api_key unless @worker_init_metadata.api_key.nil?
      values[:browser] = @worker_init_metadata.browser unless @worker_init_metadata.browser.nil?
      values[:api_url] = @config[:api_url] unless @config[:api_url].nil?
      values[:telemetry] = @config[:telemetry] unless @config[:telemetry].nil?
      values[:system_prompt] = @config[:system_prompt] unless @config[:system_prompt].nil?
      values[:self_heal] = @config[:self_heal] unless @config[:self_heal].nil?
      values[:dom_settle_timeout_ms] = @config[:dom_settle_timeout_ms] unless @config[:dom_settle_timeout_ms].nil?
      values[:cache] = @config[:cache] unless @config[:cache].nil?
      if client_llm?
        values[:model] = Models::ClientModelReference.new(source: "client")
      elsif !@config[:model].nil?
        model_values = { model_name: @config[:model] }
        model_values[:api_key] = @config[:model_api_key] unless @config[:model_api_key].nil?
        model_values[:headers] = @config[:model_headers] unless @config[:model_headers].nil?
        values[:model] = Models::ModelConfig.new(**model_values)
      end
      # api_key from create() overrides browser metadata when both are given.
      values[:api_key] = @config[:api_key] unless @config[:api_key].nil?
      values
    end

    # Ruby's JSON.generate stringifies unknown objects instead of raising, so
    # batch input is validated structurally to match the sibling SDKs.
    def assert_json_value(value)
      case value
      when nil, true, false, String, Integer
        nil
      when Float
        raise ArgumentError, "input must be JSON-serializable" unless value.finite?
      when Array
        value.each { |entry| assert_json_value(entry) }
      when Hash
        value.each do |key, entry|
          raise ArgumentError, "input must be JSON-serializable" unless key.is_a?(String) || key.is_a?(Symbol)
          assert_json_value(entry)
        end
      else
        raise ArgumentError, "input must be JSON-serializable"
      end
      nil
    end

    def handle_log(log)
      level = log.level.to_s
      return if LOG_LEVEL_PRIORITY.fetch(level, 20) < LOG_LEVEL_PRIORITY.fetch(@config[:log_level], 20)

      data = log.data.nil? || log.data == {} ? "" : " #{JSON.generate(log.data)}"
      $stderr.write("[stagehand] #{level.upcase} #{log.message}#{data}\n")
      @config[:on_log]&.call(log)
    rescue StandardError => error
      $stderr.write("[stagehand] ERROR on_log callback failed: #{error.message}\n")
    end
  end

  def self.create(**options)
    Client.create(**options)
  end
end
