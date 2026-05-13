package tlscipher

import (
	"crypto/tls"
	"testing"
)

func TestNegotiateSuiteReturnsErrorWhenNoSuiteMatches(t *testing.T) {
	registry := NewSuiteRegistry(StrengthWeak)

	name, err := registry.NegotiateSuite([]uint16{0xffff})

	if err == nil {
		t.Fatal("expected an error for unknown client suite")
	}
	if name != "" {
		t.Fatalf("expected empty suite name on failure, got %q", name)
	}
}

func TestNegotiateSuiteReturnsValidSuiteName(t *testing.T) {
	registry := NewSuiteRegistry(StrengthWeak)

	name, err := registry.NegotiateSuite([]uint16{tls.TLS_AES_128_GCM_SHA256})

	if err != nil {
		t.Fatalf("expected valid suite negotiation, got error: %v", err)
	}
	if name != "TLS_AES_128_GCM_SHA256" {
		t.Fatalf("unexpected negotiated suite name: %q", name)
	}
}
