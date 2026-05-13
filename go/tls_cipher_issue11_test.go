package tlscipher

import (
	"crypto/tls"
	"testing"
)

func TestNegotiateSuiteReturnsErrorWhenNoSuiteMatches(t *testing.T) {
	reg := NewSuiteRegistry(StrengthWeak)

	name, err := reg.NegotiateSuite([]uint16{0xffff})

	if err == nil {
		t.Fatal("expected a no-match error")
	}
	if name != "" {
		t.Fatalf("expected empty suite name on error, got %q", name)
	}
}

func TestNegotiateSuiteReturnsValidSuiteName(t *testing.T) {
	reg := NewSuiteRegistry(StrengthWeak)

	name, err := reg.NegotiateSuite([]uint16{tls.TLS_AES_128_GCM_SHA256})

	if err != nil {
		t.Fatalf("expected valid suite negotiation, got error: %v", err)
	}
	if name != "TLS_AES_128_GCM_SHA256" {
		t.Fatalf("expected TLS_AES_128_GCM_SHA256, got %q", name)
	}
}
