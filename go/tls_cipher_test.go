package tlscipher

import (
	"crypto/tls"
	"strings"
	"testing"
)

func TestNegotiateSuiteUnknownSuiteReturnsError(t *testing.T) {
	registry := NewSuiteRegistry(StrengthWeak)

	name, err := registry.NegotiateSuite([]uint16{0xffff})

	if err == nil {
		t.Fatal("expected an error for unknown suite")
	}
	if name != "" {
		t.Fatalf("expected empty suite name, got %q", name)
	}
	if !strings.Contains(err.Error(), "no mutually supported cipher suite") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestNegotiateSuiteValidSuiteReturnsName(t *testing.T) {
	registry := NewSuiteRegistry(StrengthWeak)

	name, err := registry.NegotiateSuite([]uint16{tls.TLS_AES_128_GCM_SHA256})

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if name != "TLS_AES_128_GCM_SHA256" {
		t.Fatalf("unexpected suite name: %q", name)
	}
}
