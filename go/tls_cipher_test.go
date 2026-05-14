package tlscipher

import (
	"crypto/tls"
	"testing"
)

func TestNegotiateSuite_NoMatch_ReturnsError(t *testing.T) {
	reg := NewSuiteRegistry(StrengthWeak)
	name, err := reg.NegotiateSuite([]uint16{0xFFFF})
	if err == nil {
		t.Errorf("expected error when no suite matches, got name=%q", name)
	}
}

func TestNegotiateSuite_ValidID_ReturnsName(t *testing.T) {
	reg := NewSuiteRegistry(StrengthWeak)
	name, err := reg.NegotiateSuite([]uint16{tls.TLS_AES_128_GCM_SHA256})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if name != "TLS_AES_128_GCM_SHA256" {
		t.Errorf("expected TLS_AES_128_GCM_SHA256, got %q", name)
	}
}

func TestNegotiateSuite_EmptyInput_ReturnsError(t *testing.T) {
	reg := NewSuiteRegistry(StrengthWeak)
	_, err := reg.NegotiateSuite([]uint16{})
	if err == nil {
		t.Error("expected error for empty client suites")
	}
}
