package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type imageRoundTripFunc func(*http.Request) (*http.Response, error)

func (function imageRoundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return function(request)
}

func TestImageProxyRejectsUntrustedHosts(t *testing.T) {
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/images/cover?url=https%3A%2F%2Fexample.com%2Fcover.jpg", nil)

	(&app{}).proxyImage(response, request)

	if response.Code != http.StatusUnprocessableEntity {
		t.Fatalf("image proxy status = %d, want %d", response.Code, http.StatusUnprocessableEntity)
	}
}

func TestImageProxyReturnsSupportedProviderImage(t *testing.T) {
	client := &http.Client{Transport: imageRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		if request.URL.Host != "image.tmdb.org" {
			t.Fatalf("image proxy requested unexpected host %q", request.URL.Host)
		}
		return &http.Response{
			StatusCode:    http.StatusOK,
			Header:        http.Header{"Content-Type": []string{"image/jpeg"}},
			Body:          io.NopCloser(strings.NewReader("jpeg-data")),
			ContentLength: 9,
			Request:       request,
		}, nil
	})}
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/images/cover?url=https%3A%2F%2Fimage.tmdb.org%2Ft%2Fp%2Fw500%2Fcover.jpg", nil)

	(&app{imageClient: client}).proxyImage(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("image proxy status = %d, body = %q", response.Code, response.Body.String())
	}
	if contentType := response.Header().Get("Content-Type"); contentType != "image/jpeg" {
		t.Fatalf("image proxy content type = %q", contentType)
	}
	if body := response.Body.String(); body != "jpeg-data" {
		t.Fatalf("image proxy body = %q", body)
	}
}

func TestImageProxyRejectsUnsupportedContent(t *testing.T) {
	client := &http.Client{Transport: imageRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"text/html"}},
			Body:       io.NopCloser(strings.NewReader("not an image")),
			Request:    request,
		}, nil
	})}
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/images/cover?url=https%3A%2F%2Fs4.anilist.co%2Fcover.jpg", nil)

	(&app{imageClient: client}).proxyImage(response, request)

	if response.Code != http.StatusBadGateway {
		t.Fatalf("image proxy status = %d, want %d", response.Code, http.StatusBadGateway)
	}
}
