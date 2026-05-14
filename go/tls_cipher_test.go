package tlscipher

import (
	"crypto/tls"
	"testing"
)

func TestNegotiateSuiteUnknownSuiteReturnsError(t *testing.T) {
	reg := NewSuiteRegistry(StrengthWeak)

	name, err := reg.NegotiateSuite([]uint16{0xffff})
	if err == nil {
		t.Fatal("expected an error for an unknown cipher suite")
	}
	if name != "" {
		t.Fatalf("expected empty suite name, got %q", name)
	}
}

func TestNegotiateSuiteValidSuiteReturnsName(t *testing.T) {
	reg := NewSuiteRegistry(StrengthWeak)

	name, err := reg.NegotiateSuite([]uint16{tls.TLS_AES_128_GCM_SHA256})
	if err != nil {
		t.Fatalf("expected valid suite to negotiate, got error: %v", err)
	}
	if name != "TLS_AES_128_GCM_SHA256" {
		t.Fatalf("expected TLS_AES_128_GCM_SHA256, got %q", name)
	}
}
