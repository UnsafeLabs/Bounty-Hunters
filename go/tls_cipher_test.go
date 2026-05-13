package tlscipher

import (
	"crypto/tls"
	"testing"
)

func TestNegotiateSuiteUnknownIDsReturnsError(t *testing.T) {
	reg := NewSuiteRegistry(StrengthWeak)
	name, err := reg.NegotiateSuite([]uint16{0xFFFF})

	if err == nil {
		t.Fatalf("expected error for unknown cipher ID, got name=%q", name)
	}
	if name != "" {
		t.Fatalf("expected empty name when no suite matches, got %q", name)
	}
}

func TestNegotiateSuiteValidIDReturnsName(t *testing.T) {
	reg := NewSuiteRegistry(StrengthWeak)
	name, err := reg.NegotiateSuite([]uint16{tls.TLS_AES_128_GCM_SHA256})

	if err != nil {
		t.Fatalf("expected nil error, got %v", err)
	}
	if name != "TLS_AES_128_GCM_SHA256" {
		t.Fatalf("expected TLS_AES_128_GCM_SHA256, got %q", name)
	}
}

func TestNegotiateSuiteEmptyClientList(t *testing.T) {
	reg := NewSuiteRegistry(StrengthWeak)
	name, err := reg.NegotiateSuite(nil)

	if err == nil {
		t.Fatalf("expected error for empty client list, got name=%q", name)
	}
}
