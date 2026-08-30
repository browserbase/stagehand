# frozen_string_literal: true

require "pathname"

require_relative "generated/models"
require_relative "browser_clipboard"
require_relative "page"
require_relative "rpc_client"

module Stagehand
  # Context surface: page management, cookies, clipboard, domain policy,
  # headers, and init scripts. Port of
  # packages/sdk-python/src/stagehand/browser_context.py.
  class BrowserContext
    def initialize(rpc_client)
      @rpc_client = rpc_client
      @clipboard = nil
    end

    def clipboard
      @clipboard ||= BrowserClipboard.new(@rpc_client)
    end

    def pages
      result = @rpc_client.send("context.pages", Models::EmptyParams.new, "ContextPagesResult")
      result.map { |page_ref| Page.new(@rpc_client, page_ref) }
    end

    def new_page(url = nil)
      params = url.nil? ? Models::ContextNewPageParams.new : Models::ContextNewPageParams.new(url: url)
      page_ref = @rpc_client.send("context.new_page", params, "PageRef")
      Page.new(@rpc_client, page_ref)
    end

    def active_page
      result = @rpc_client.send("context.active_page", Models::EmptyParams.new, "ContextActivePageResult")
      result.nil? ? nil : Page.new(@rpc_client, result)
    end

    def set_active_page(page)
      @rpc_client.send("context.set_active_page", Models::ContextSetActivePageParams.new(page_id: page.page_id), "ContextVoidResult")
      nil
    end

    # Closes the remote context; use Stagehand::Client#close to release local
    # resources.
    def close
      @rpc_client.send("context.close", Models::EmptyParams.new, "ContextCloseResult")
      nil
    end

    # source is JavaScript text, or a Pathname whose contents are read and
    # tagged with a sourceURL comment (matching the sibling SDKs).
    def add_init_script(source)
      @rpc_client.send("context.add_init_script", Models::ContextAddInitScriptParams.new(source: init_script_source(source)), "ContextVoidResult")
      nil
    end

    def set_extra_http_headers(headers)
      @rpc_client.send("context.set_extra_http_headers", Models::ContextSetExtraHTTPHeadersParams.new(headers: headers.to_h), "ContextVoidResult")
      nil
    end

    # Models::DomainPolicy or nil when no policy is set.
    def get_domain_policy
      @rpc_client.send("context.get_domain_policy", Models::EmptyParams.new, "ContextGetDomainPolicyResult")
    end

    # policy: Models::DomainPolicy, a Hash with allowed_domains/blocked_domains,
    # or nil to clear the policy.
    def set_domain_policy(policy)
      encoded =
        case policy
        when nil, Models::DomainPolicy then policy
        when Hash then Models::DomainPolicy.new(**policy.transform_keys(&:to_sym))
        else raise ArgumentError, "policy must be a Models::DomainPolicy, a Hash, or nil"
        end
      @rpc_client.send("context.set_domain_policy", Models::ContextSetDomainPolicyParams.new(policy: encoded), "ContextVoidResult")
      nil
    end

    # Cookies visible to the context, optionally filtered to one or more URLs.
    # Returns an array of Models::Cookie.
    def cookies(urls = nil)
      params =
        if urls.nil?
          Models::ContextCookiesParams.new
        else
          Models::ContextCookiesParams.new(urls: urls.is_a?(String) ? urls : urls.to_a)
        end
      @rpc_client.send("context.cookies", params, "ContextCookiesResult")
    end

    # cookies: array of Models::CookieParam or Hashes (name/value required;
    # url, or domain+path, plus expires/http_only/secure/same_site optional).
    def add_cookies(cookies)
      encoded = cookies.map do |cookie|
        cookie.is_a?(Models::CookieParam) ? cookie : Models::CookieParam.new(**cookie.transform_keys(&:to_sym))
      end
      @rpc_client.send("context.add_cookies", Models::ContextAddCookiesParams.new(cookies: encoded), "ContextVoidResult")
      nil
    end

    # Each filter is a String (exact match), a Regexp, or a
    # Models::CookieRegex. Ruby Regexp options map to JavaScript flags as
    # i => i and m => s (Ruby's MULTILINE is JavaScript's dotall); extended
    # mode has no JavaScript equivalent and raises.
    def clear_cookies(name: nil, domain: nil, path: nil)
      filters = {}
      { name: name, domain: domain, path: path }.each do |field, value|
        filters[field] = cookie_filter(value) unless value.nil?
      end
      values = filters.empty? ? {} : { options: Models::ClearCookieOptions.new(**filters) }
      @rpc_client.send("context.clear_cookies", Models::ContextClearCookiesParams.new(**values), "ContextVoidResult")
      nil
    end

    private

    def cookie_filter(value)
      case value
      when String, Models::CookieRegex
        value
      when Regexp
        if (value.options & Regexp::EXTENDED) != 0
          raise ArgumentError, "extended-mode Regexp cookie filters cannot be expressed as JavaScript regular expressions"
        end
        flags = +""
        flags << "i" if (value.options & Regexp::IGNORECASE) != 0
        flags << "s" if (value.options & Regexp::MULTILINE) != 0
        Models::CookieRegex.new(source: value.source, **(flags.empty? ? {} : { flags: flags }))
      else
        raise ArgumentError, "cookie filters must be a String, Regexp, or Models::CookieRegex"
      end
    end

    def init_script_source(source)
      return source unless source.is_a?(Pathname)

      source_url = source.to_s.delete("\n")
      "#{source.read}\n//# sourceURL=#{source_url}"
    end

  end
end
