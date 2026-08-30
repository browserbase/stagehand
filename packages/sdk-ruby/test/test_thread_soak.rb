# frozen_string_literal: true

require_relative "test_helper"
require_relative "support/fake_transport"

# Thread-safety soak for the RPC layer: concurrent senders, out-of-order
# responses, inbound requests whose handler issues nested RPC calls, and
# notifications — all at once. SOAK=10 (etc.) scales the load for longer
# local runs; the default stays CI-fast.
class TestThreadSoak < Minitest::Test
  FACTOR = [ENV.fetch("SOAK", "1").to_i, 1].max
  SENDERS = 8
  REQUESTS_PER_SENDER = 25 * FACTOR
  INBOUND_REQUESTS = 20 * FACTOR
  NOTIFICATIONS = 50 * FACTOR
  INBOUND_ID_BASE = 100_000

  def setup
    @transport = FakeTransport.new
    @client = Stagehand::RPCClient.new(@transport)
  end

  def teardown
    @client.close
  end

  # Answers outbound requests in reversed batches (forcing out-of-order
  # response routing) and collects the client's replies to inbound requests.
  def start_responder(inbound_reply_ids)
    Thread.new do
      batch = []
      loop do
        message = @transport.sent.pop(timeout: 2)
        break if message.nil?
        if message.key?("method")
          batch << message
          next if batch.size < 5 && !@transport.sent.empty?
          batch.reverse_each do |request|
            page_id = request.dig("params", "page_id")
            @transport.push({ "jsonrpc" => "2.0", "id" => request["id"], "result" => "title for #{page_id}" })
          end
          batch.clear
        elsif message["id"].is_a?(Integer) && message["id"] >= INBOUND_ID_BASE
          inbound_reply_ids << [message["id"], message.key?("result")]
        end
      end
    end
  end

  def test_soak_concurrent_senders_inbound_requests_and_notifications
    inbound_reply_ids = Thread::Queue.new
    responder = start_responder(inbound_reply_ids)

    notified = Thread::Queue.new
    @client.on_notification("stagehand.log") { |log| notified << log.message }

    @client.on_request("llm.generate") do |_params|
      # Nested RPC call from inside a handler, while senders hammer away.
      title = @client.send("page.title", Stagehand::Models::PageIdParams.new(page_id: "nested"), "PageTitleResult")
      Stagehand::Models::LLMStructuredGenerateResult.new(
        role: "assistant",
        content: Stagehand::Models::LLMTextContent.new(type: "text", text: title),
        output_format: "json_schema",
        structured_content: { "title" => title },
      )
    end

    errors = Thread::Queue.new
    senders = SENDERS.times.map do |sender_index|
      Thread.new do
        REQUESTS_PER_SENDER.times do |request_index|
          page_id = "p#{sender_index}-#{request_index}"
          result = @client.send("page.title", Stagehand::Models::PageIdParams.new(page_id: page_id), "PageTitleResult")
          errors << "mismatch for #{page_id}: #{result.inspect}" unless result == "title for #{page_id}"
        end
      rescue StandardError => error
        errors << "sender #{sender_index}: #{error.class}: #{error.message}"
      end
    end

    feeder = Thread.new do
      INBOUND_REQUESTS.times do |index|
        @transport.push({
          "jsonrpc" => "2.0", "id" => INBOUND_ID_BASE + index, "method" => "llm.generate",
          "params" => {
            "messages" => [{ "role" => "user", "content" => { "type" => "text", "text" => "soak #{index}" } }],
            "response_format" => { "type" => "json_schema", "name" => "soak", "schema" => { "type" => "object" } },
          },
        })
      end
      NOTIFICATIONS.times do |index|
        @transport.push(JSON.generate({
          "jsonrpc" => "2.0", "method" => "stagehand.log",
          "params" => { "level" => "info", "message" => "note-#{index}", "data" => {} },
        }))
      end
    end

    senders.each { |thread| assert thread.join(30), "sender thread did not finish" }
    feeder.join

    # Inbound dispatch is async: drain the expected counts with deadlines.
    replies = INBOUND_REQUESTS.times.map { inbound_reply_ids.pop(timeout: 10) }
    refute_includes replies, nil, "missing replies to inbound llm.generate requests"
    assert_equal (INBOUND_ID_BASE...(INBOUND_ID_BASE + INBOUND_REQUESTS)).to_a, replies.map(&:first).sort
    assert replies.all?(&:last), "an inbound request was answered with an error"

    messages = NOTIFICATIONS.times.map { notified.pop(timeout: 10) }
    refute_includes messages, nil, "lost notifications"
    assert_equal NOTIFICATIONS.times.map { |index| "note-#{index}" }, messages.sort_by { |m| m.split("-").last.to_i }

    failures = [].tap { |list| list << errors.pop until errors.empty? }
    assert_empty failures
    responder.kill
  end

  def test_close_under_fire_rejects_everything_and_terminates
    barrier = Thread::Queue.new
    senders = SENDERS.times.map do |index|
      Thread.new do
        Thread.current.report_on_exception = false
        barrier.pop
        loop do
          @client.send("page.title", Stagehand::Models::PageIdParams.new(page_id: "x#{index}"), "PageTitleResult")
        end
      rescue Stagehand::StagehandError
        :closed
      end
    end
    SENDERS.times { barrier << :go }
    sleep 0.05 # let requests get in flight (nothing answers them)
    @client.close
    senders.each do |thread|
      assert thread.join(10), "sender did not terminate after close"
      assert_equal :closed, thread.value
    end
    assert @client.closed?
  end
end
