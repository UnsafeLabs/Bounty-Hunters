package tlscipher

import (
	"crypto/tls"
	"testing"
)

func TestNegotiateSuiteReturnsErrorWhenNoSuiteMatches(t *testing.T) {
	registry := NewSuiteRegistry(StrengthWeak)

	name, err := registry.NegotiateSuite([]uint16{0xffff})
	if err == nil {
		t.Fatal("expected an error when no offered suite matches")
	}
	if name != "" {
		t.Fatalf("expected empty suite name on failure, got %q", name)
	}
}

func TestNegotiateSuiteReturnsMatchedSuite(t *testing.T) {
	registry := NewSuiteRegistry(StrengthWeak)

	name, err := registry.NegotiateSuite([]uint16{tls.TLS_AES_128_GCM_SHA256})
	if err != nil {
		t.Fatalf("expected valid suite to negotiate, got error: %v", err)
	}
	if name != "TLS_AES_128_GCM_SHA256" {
		t.Fatalf("unexpected negotiated suite %q", name)
	}
}