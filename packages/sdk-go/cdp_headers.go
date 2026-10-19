package stagehand

import (
	"errors"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
)

var cdpHeaderName = regexp.MustCompile("^[!#$%&'*+.^_`|~0-9A-Za-z-]+$")
var errUnsafeCDPRedirect = errors.New("refusing CDP redirect with headers to a different host or port, an insecure transport, or a URL containing credentials")
var errCDPRedirectLimit = errors.New("too many CDP redirects")

func validateCDPHeader(name, value string) error {
	valid := cdpHeaderName.MatchString(name) && value == strings.Trim(value, " \t")
	for i := 0; i < len(value); i++ {
		if value[i] != '\t' && (value[i] < 0x20 || value[i] > 0x7e) {
			valid = false
		}
	}
	if !valid {
		return errors.New("headers must map valid HTTP header names to ASCII string values without leading or trailing spaces or tabs")
	}
	return nil
}

func canForwardCDPHeaders(source, destination string) bool {
	first, err := url.Parse(source)
	if err != nil {
		return false
	}
	second, err := url.Parse(destination)
	if err != nil {
		return false
	}
	ports := map[string]string{"http": "80", "ws": "80", "https": "443", "wss": "443"}
	if ports[first.Scheme] == "" || ports[second.Scheme] == "" || first.Hostname() == "" || !strings.EqualFold(first.Hostname(), second.Hostname()) {
		return false
	}
	firstPort, secondPort := first.Port(), second.Port()
	if firstPort == "" {
		firstPort = ports[first.Scheme]
	}
	if secondPort == "" {
		secondPort = ports[second.Scheme]
	}
	firstNumber, firstErr := strconv.ParseUint(firstPort, 10, 16)
	secondNumber, secondErr := strconv.ParseUint(secondPort, 10, 16)
	return firstErr == nil && secondErr == nil && firstNumber > 0 && firstNumber == secondNumber && !((first.Scheme == "https" || first.Scheme == "wss") && (second.Scheme == "http" || second.Scheme == "ws"))
}

// Clone the client so the caller's transport, timeout and redirect policy remain intact.
func cdpHTTPClientWithHeaders(client *http.Client, headers http.Header) *http.Client {
	if client == nil {
		client = http.DefaultClient
	}
	if len(headers) == 0 {
		return client
	}
	guarded := *client
	guarded.CheckRedirect = func(request *http.Request, via []*http.Request) error {
		if len(via) >= 10 {
			return errCDPRedirectLimit
		}
		if len(via) == 0 || request.URL == nil {
			return errUnsafeCDPRedirect
		}
		// Capture the source before the caller callback can mutate requests.
		source := via[len(via)-1].URL.String()
		if request.URL.User != nil || !canForwardCDPHeaders(source, request.URL.String()) {
			return errUnsafeCDPRedirect
		}
		if client.CheckRedirect != nil {
			if err := client.CheckRedirect(request, via); err != nil {
				return err
			}
			if request.URL == nil || request.URL.User != nil || !canForwardCDPHeaders(source, request.URL.String()) {
				return errUnsafeCDPRedirect
			}
		}
		return nil
	}
	return &guarded
}
