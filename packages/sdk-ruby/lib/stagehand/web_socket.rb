# frozen_string_literal: true

require "socket"
require "openssl"
require "uri"
require "websocket/driver"

require_relative "errors"

module Stagehand
  # Minimal synchronous WebSocket client on top of websocket-driver: one
  # background reader thread feeds the driver, frames land on a queue, and
  # writes are mutex-serialized (the driver itself is not thread-safe).
  class WebSocketConnection
    # Screenshots and response bodies arrive base64-encoded in single frames,
    # so allow very large messages (websockets' Python default is unlimited).
    MAX_FRAME_LENGTH = 2**30
    OPEN_TIMEOUT_SECONDS = 30
    PING_INTERVAL_SECONDS = 15

    CLOSED = Object.new

    attr_reader :url

    def initialize(url)
      @url = url
      @write_mutex = Mutex.new
      @messages = Thread::Queue.new
      @closed = false
      @io = open_io(URI(url))
      @driver = WebSocket::Driver.client(self, max_length: MAX_FRAME_LENGTH)

      opened = Thread::Queue.new
      @driver.on(:open) { opened << true }
      @driver.on(:message) { |event| @messages << event.data }
      @driver.on(:close) { finish(nil) }
      @driver.on(:error) { |event| finish(CDPConnectionClosedError.new(event.message.to_s)) }

      @reader = Thread.new { read_loop }
      @reader.name = "stagehand-websocket-reader"
      @write_mutex.synchronize { @driver.start }
      raise CDPConnectionClosedError, "WebSocket handshake timed out" if opened.pop(timeout: OPEN_TIMEOUT_SECONDS).nil?

      @pinger = Thread.new { ping_loop }
      @pinger.name = "stagehand-websocket-pinger"
    end

    # Called by websocket-driver.
    def write(data)
      @io.write(data)
    rescue IOError, SystemCallError, OpenSSL::SSL::SSLError => error
      raise CDPConnectionClosedError, "WebSocket write failed: #{error.message}"
    end

    def send_text(text)
      @write_mutex.synchronize do
        raise CDPConnectionClosedError if @closed
        @driver.text(text)
      end
    end

    # Blocks until the next text frame; raises when the connection is gone.
    def recv
      message = @messages.pop
      raise CDPConnectionClosedError if message.equal?(CLOSED)
      message
    end

    def close
      finish(nil)
      @reader.join(2) unless Thread.current == @reader
      @pinger&.kill
      nil
    end

    private

    def open_io(uri)
      port = uri.port || (uri.scheme == "wss" ? 443 : 80)
      tcp = TCPSocket.new(uri.host, port)
      tcp.setsockopt(Socket::IPPROTO_TCP, Socket::TCP_NODELAY, 1)
      return tcp unless uri.scheme == "wss"

      context = OpenSSL::SSL::SSLContext.new
      context.set_params(verify_mode: OpenSSL::SSL::VERIFY_PEER)
      ssl = OpenSSL::SSL::SSLSocket.new(tcp, context)
      ssl.hostname = uri.host
      ssl.sync_close = true
      ssl.connect
      ssl
    end

    def read_loop
      loop do
        data = @io.readpartial(65_536)
        @driver.parse(data)
      end
    rescue IOError, EOFError, SystemCallError, OpenSSL::SSL::SSLError
      finish(nil)
    end

    def ping_loop
      loop do
        sleep(PING_INTERVAL_SECONDS)
        break if @closed
        @write_mutex.synchronize { @driver.ping }
      end
    rescue StandardError
      nil
    end

    def finish(_error)
      @write_mutex.synchronize do
        return if @closed
        @closed = true
      end
      @messages << CLOSED
      begin
        @io.close
      rescue IOError, SystemCallError
        nil
      end
    end
  end
end
