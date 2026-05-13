package tlscipher

import (
	"crypto/tls"
	"testing"
)

func TestNegotiateSuiteReturnsErrorWhenNoSuiteMatches(t *testing.T) {
	reg := NewSuiteRegistry(StrengthModern)

	name, err := reg.NegotiateSuite([]uint16{0xffff})
	if err == nil {
		t.Fatal("expected unsupported client suite to return an error")
	}
	if name != "" {
		t.Fatalf("expected no selected suite, got %q", name)
	}
}

func TestNegotiateSuiteKeepsValidSuite(t *testing.T) {
	reg := NewSuiteRegistry(StrengthModern)

	name, err := reg.NegotiateSuite([]uint16{tls.TLS_AES_128_GCM_SHA256})
	if err != nil {
		t.Fatalf("expected valid suite to negotiate: %v", err)
	}
	if name != "TLS_AES_128_GCM_SHA256" {
		t.Fatalf("unexpected suite %q", name)
	}
}
