package tlscipher

import (
	"crypto/tls"
	"testing"
)

func TestNegotiateSuiteHandlesUnknownAndValidSuites(t *testing.T) {
	reg := NewSuiteRegistry(StrengthLegacy)

	if name, err := reg.NegotiateSuite([]uint16{0xffff}); err == nil {
		t.Fatalf("expected error for unknown suite, got name %q", name)
	}

	name, err := reg.NegotiateSuite([]uint16{tls.TLS_AES_128_GCM_SHA256})
	if err != nil {
		t.Fatalf("expected valid suite negotiation to succeed: %v", err)
	}
	if name != "TLS_AES_128_GCM_SHA256" {
		t.Fatalf("unexpected negotiated suite: %q", name)
	}
}
