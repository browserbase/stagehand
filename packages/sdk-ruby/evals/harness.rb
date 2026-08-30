# frozen_string_literal: true

# Ruby port of the packages/evals bench-tier harness: tasks are auto-
# discovered from evals/tasks/<category>/*.rb, receive a context with a live
# Stagehand client, and return a Hash with `_success:`. Raising counts as a
# failure (the TS tasks' per-task begin/rescue lives here instead).

require_relative "../lib/stagehand"

module Evals
  Task = Struct.new(:name, :category, :file, :block, keyword_init: true)

  # Mirrors the TS EvalLogger surface the bench tasks use.
  class TaskLogger
    attr_reader :logs

    def initialize
      @logs = []
    end

    def log(message, auxiliary = {})
      @logs << { "level" => "info", "message" => message, "auxiliary" => auxiliary }
    end

    def error(message, auxiliary = {})
      @logs << { "level" => "error", "message" => message, "auxiliary" => auxiliary }
    end
    alias warn log
  end

  # What a task block receives (`t.stagehand`, `t.page`, `t.logger`).
  Context = Struct.new(:stagehand, :page, :logger, keyword_init: true)

  class << self
    def tasks
      @tasks ||= []
    end

    # One extension upload per runner invocation: per-session uploads trip
    # Browserbase's POST /v1/extensions rate limit under concurrency.
    def shared_extension_id
      @extension_mutex ||= Mutex.new
      @extension_mutex.synchronize do
        @shared_extension_id ||= Stagehand::BrowserbaseClient
          .new(api_key: ENV.fetch("BROWSERBASE_API_KEY"), base_url: Stagehand::BrowserbaseSession::DEFAULT_BROWSERBASE_URL)
          .upload_extension(Stagehand::ExtensionAssets.build_extension_archive)
      end
    end

    def delete_shared_extension
      return if @shared_extension_id.nil?
      Stagehand::BrowserbaseClient
        .new(api_key: ENV.fetch("BROWSERBASE_API_KEY"), base_url: Stagehand::BrowserbaseSession::DEFAULT_BROWSERBASE_URL)
        .delete_extension(@shared_extension_id)
      @shared_extension_id = nil
    rescue StandardError
      nil
    end

    def define_task(name, &block)
      raise ArgumentError, "a task block is required" if block.nil?
      tasks << Task.new(name: name, category: @loading_category, file: @loading_file, block: block)
    end

    def load_tasks(root = File.join(__dir__, "tasks"))
      Dir.children(root).sort.each do |category|
        directory = File.join(root, category)
        next unless File.directory?(directory)
        Dir.glob(File.join(directory, "*.rb")).sort.each do |file|
          @loading_category = category
          @loading_file = file
          load file
        end
      end
      @loading_category = @loading_file = nil
      tasks
    end

    # Runs one task in a fresh browser + Stagehand instance and returns the
    # task's result Hash (string keys) plus timing.
    def run_task(task, browserbase: true, model: nil, model_api_key: nil, log_level: "error")
      started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
      logger = TaskLogger.new
      session_id = nil
      result =
        begin
          browser =
            if browserbase
              Stagehand::Browserbase.launch(
                api_key: ENV.fetch("BROWSERBASE_API_KEY"),
                extension_id: shared_extension_id,
              )
            else
              Stagehand::LocalBrowser.launch(headless: ENV["HEADED"].nil?)
            end
          begin
            session_id = browser.session_id
            # selfHeal defaults off on the server; without it the heal_*
            # benchmarks pass while measuring nothing (mirrors the TS evals).
            create_options = { browser: browser, log_level: log_level, self_heal: true }
            if model
              create_options[:model] = model
              create_options[:model_api_key] = model_api_key if model_api_key
            end
            stagehand = Stagehand.create(**create_options)
            begin
              page = browser.context.pages.first
              raise "Stagehand initialized without an active page" if page.nil?
              raw = task.block.call(Context.new(stagehand: stagehand, page: page, logger: logger))
              raw.is_a?(Hash) ? raw : { _success: false, error: "task returned #{raw.class} instead of a Hash" }
            ensure
              stagehand.close
            end
          ensure
            browser.close
          end
        rescue StandardError => error
          { _success: false, error: "#{error.class}: #{error.message}" }
        end
      duration_ms = ((Process.clock_gettime(Process::CLOCK_MONOTONIC) - started) * 1000).round
      result.transform_keys(&:to_s).merge(
        "task" => task.name,
        "category" => task.category,
        "duration_ms" => duration_ms,
        "session_id" => session_id,
        "logs" => logger.logs,
      )
    end
  end
end
