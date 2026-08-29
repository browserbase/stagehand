# frozen_string_literal: true

# In-memory stand-in for the CDP transport used by RPCClient tests.
class FakeTransport
  attr_reader :sent

  def initialize
    @sent = Thread::Queue.new
    @inbound = Thread::Queue.new
    @closed = false
  end

  def send(message)
    @sent << message
  end

  # Mirrors the real CDP transport: close unblocks receive with an error.
  def receive
    value = @inbound.pop
    raise value if value.is_a?(Exception)
    value
  end

  def push(message)
    @inbound << message
  end

  def next_sent(timeout: 2)
    value = @sent.pop(timeout: timeout)
    raise "no message sent" if value.nil?
    value
  end

  def close
    @closed = true
    @inbound << Stagehand::CDPConnectionClosedError.new
  end

  def closed?
    @closed
  end
end

# Shared harness for suites that exercise wrappers over a real RPCClient:
# responds to the next outbound request and records it for assertions.
module RPCHarness
  def start_rpc
    @transport = FakeTransport.new
    @rpc_client = Stagehand::RPCClient.new(@transport)
  end

  def stop_rpc
    @rpc_client&.close
  end

  # Runs the block while answering the next request with `result`; returns
  # the request that was sent.
  def expect_rpc(result:)
    responder = Thread.new do
      request = @transport.next_sent
      @transport.push({ "jsonrpc" => "2.0", "id" => request["id"], "result" => result })
      request
    end
    yield
    responder.value
  end
end
