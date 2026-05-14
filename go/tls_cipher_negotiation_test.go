package tlscipher

import (
	"crypto/tls"
	"testing"
)

func TestNegotiateSuiteReturnsErrorForUnknownOffer(t *testing.T) {
	reg := NewSuiteRegistry(StrengthLegacy)

	name, err := reg.NegotiateSuite([]uint16{0xffff})
	if err == nil {
		t.Fatalf("expected no-match error, got suite name %q", name)
	}
	if name != "" {
		t.Fatalf("expected empty suite name for no match, got %q", name)
	}
}

func TestNegotiateSuiteReturnsNameForSupportedOffer(t *testing.T) {
	reg := NewSuiteRegistry(StrengthLegacy)

	name, err := reg.NegotiateSuite([]uint16{tls.TLS_AES_128_GCM_SHA256})
	if err != nil {
		t.Fatalf("expected supported suite to negotiate successfully: %v", err)
	}
	if name != "TLS_AES_128_GCM_SHA256" {
		t.Fatalf("expected TLS_AES_128_GCM_SHA256, got %q", name)
	}
}
