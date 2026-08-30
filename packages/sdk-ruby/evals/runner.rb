# frozen_string_literal: true

# Runs the Ruby ports of the bench eval tasks. Usage from packages/sdk-ruby:
#
#   bundle exec ruby evals/runner.rb                     # every task, Browserbase
#   bundle exec ruby evals/runner.rb extract             # one category
#   bundle exec ruby evals/runner.rb extract/extract_csa # one task
#   bundle exec ruby evals/runner.rb --trials 3 --concurrency 8
#   bundle exec ruby evals/runner.rb --local             # local Chrome (needs OPENAI_API_KEY)
#
# Model: EVAL_MODEL (+ EVAL_MODEL_API_KEY / OPENAI_API_KEY) when set;
# otherwise the Browserbase Model Gateway picks one per inference call.
# Results stream to stdout and to evals/results/<timestamp>.jsonl.

require "json"
require "optparse"

require_relative "harness"

options = { trials: 1, concurrency: 4, browserbase: true }
parser = OptionParser.new do |opts|
  opts.banner = "Usage: ruby evals/runner.rb [target] [options]"
  opts.on("--trials N", Integer, "Trials per task (default 1)") { |n| options[:trials] = n }
  opts.on("--concurrency N", Integer, "Parallel sessions (default 4)") { |n| options[:concurrency] = n }
  opts.on("--local", "Local Chrome instead of Browserbase") { options[:browserbase] = false }
  opts.on("--model NAME", "Model name (default: Browserbase Model Gateway)") { |m| options[:model] = m }
end
targets = parser.parse(ARGV)

model = options[:model] || ENV.fetch("EVAL_MODEL", nil)
model = nil if model && model.empty?
model_api_key = ENV["EVAL_MODEL_API_KEY"] || ENV.fetch("OPENAI_API_KEY", nil)
model_api_key = nil if model_api_key && model_api_key.empty?
if !options[:browserbase] && model.nil?
  abort "Local runs need a model: set EVAL_MODEL (+ key) or pass --model (the Gateway is Browserbase-only)."
end

all_tasks = Evals.load_tasks
tasks =
  if targets.empty? || targets == ["all"]
    all_tasks
  else
    selected = targets.flat_map do |target|
      category, name = target.include?("/") ? target.split("/", 2) : [target, nil]
      matches = all_tasks.select do |task|
        if name
          task.category == category && task.name == name
        else
          task.category == target || task.name == target
        end
      end
      abort "No tasks match #{target.inspect}. Categories: #{all_tasks.map(&:category).uniq.join(", ")}" if matches.empty?
      matches
    end.uniq
    selected
  end

jobs = Queue.new
tasks.each { |task| options[:trials].times { |trial| jobs << [task, trial] } }
total = jobs.size
options[:concurrency].times { jobs << nil }

require "fileutils"
FileUtils.mkdir_p(File.join(__dir__, "results"))
results_path = File.join(__dir__, "results", "#{Time.now.strftime("%Y%m%d-%H%M%S")}.jsonl")
results_file = File.open(results_path, "a")
io_mutex = Mutex.new
results = []
completed = 0

puts "Running #{tasks.size} task(s) × #{options[:trials]} trial(s) = #{total} run(s) " \
     "on #{options[:browserbase] ? "Browserbase" : "local Chrome"} " \
     "(model: #{model || "Browserbase Model Gateway"}, concurrency #{options[:concurrency]})"

# Upload the extension once up front; every session reuses it.
Evals.shared_extension_id if options[:browserbase]
at_exit { Evals.delete_shared_extension }

workers = options[:concurrency].times.map do
  Thread.new do
    loop do
      job = jobs.pop
      break if job.nil?
      task, trial = job
      result = Evals.run_task(
        task,
        browserbase: options[:browserbase],
        model: model,
        model_api_key: model_api_key,
      ).merge("trial" => trial)
      io_mutex.synchronize do
        results << result
        completed += 1
        status = result["_success"] ? "PASS" : "FAIL"
        detail = result["_success"] ? "" : "  #{(result["error"] || "assertion failed").to_s.slice(0, 120)}"
        puts format(
          "[%<done>3d/%<total>d] %<status>s  %<name>-42s %<ms>6dms%<detail>s",
          done: completed, total: total, status: status,
          name: "#{task.category}/#{task.name}", ms: result["duration_ms"], detail: detail,
        )
        results_file.puts(JSON.generate(result))
        results_file.flush
      end
    end
  end
end
workers.each(&:join)
results_file.close

puts "\nResults: #{results_path}"
summary = results.group_by { |result| result["category"] }.sort
overall_passed = results.count { |result| result["_success"] }
summary.each do |category, entries|
  passed = entries.count { |entry| entry["_success"] }
  puts format("  %<category>-10s %<passed>3d/%<total>d passed", category: category, passed: passed, total: entries.size)
end
puts format("  %<label>-10s %<passed>3d/%<total>d passed", label: "overall", passed: overall_passed, total: results.size)

failures = results.reject { |result| result["_success"] }
unless failures.empty?
  puts "\nFailed runs:"
  failures.each do |failure|
    puts "  #{failure["category"]}/#{failure["task"]} (trial #{failure["trial"]}): " \
         "#{(failure["error"] || "assertion failed").to_s.slice(0, 160)} [session #{failure["session_id"]}]"
  end
end

exit(failures.empty? ? 0 : 1)
