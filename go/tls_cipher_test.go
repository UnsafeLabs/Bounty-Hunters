package tlscipher

import (
	"crypto/tls"
	"strings"
	"testing"
)

func TestNegotiateSuite_ReturnsErrorWhenNoMatch(t *testing.T) {
	reg := NewSuiteRegistry(StrengthLegacy)

	name, err := reg.NegotiateSuite([]uint16{0xFFFF})
	if err == nil {
		t.Fatalf("expected non-nil error, got nil (name=%q)", name)
	}
	if name != "" {
		t.Errorf("expected empty name on no-match, got %q", name)
	}
}

func TestNegotiateSuite_ReturnsNameOnMatch(t *testing.T) {
	reg := NewSuiteRegistry(StrengthLegacy)

	name, err := reg.NegotiateSuite([]uint16{tls.TLS_AES_128_GCM_SHA256})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if name != "TLS_AES_128_GCM_SHA256" {
		t.Errorf("expected TLS_AES_128_GCM_SHA256, got %q", name)
	}
}

func TestNegotiateSuite_ErrorsOnEmptyClientSuites(t *testing.T) {
	reg := NewSuiteRegistry(StrengthLegacy)

	name, err := reg.NegotiateSuite(nil)
	if err == nil {
		t.Fatalf("expected error on empty client suites, got name=%q", name)
	}
	if !strings.Contains(err.Error(), "no cipher suites") {
		t.Errorf("expected 'no cipher suites' in error, got %q", err.Error())
	}
}

func TestNegotiateSuite_NoPanicOnUnknownIDs(t *testing.T) {
	reg := NewSuiteRegistry(StrengthLegacy)

	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("NegotiateSuite panicked on unknown IDs: %v", r)
		}
	}()

	_, _ = reg.NegotiateSuite([]uint16{0xFFFF, 0xFFFE, 0xDEAD})
}
