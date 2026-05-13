package tlscipher

import (
	"crypto/tls"
	"testing"
)

func TestFilterWeakSuitesRejectsRC4And3DESByName(t *testing.T) {
	reg := NewSuiteRegistry(StrengthWeak)
	suites := []*CipherSuite{
		{
			ID:       0x0005,
			Name:     "TLS_RSA_WITH_RC4_128_SHA",
			KeySize:  128,
			Strength: StrengthWeak,
		},
		{
			ID:       0x000a,
			Name:     "TLS_RSA_WITH_3DES_EDE_CBC_SHA",
			KeySize:  168,
			Strength: StrengthWeak,
		},
		{
			ID:       tls.TLS_AES_128_GCM_SHA256,
			Name:     "TLS_AES_128_GCM_SHA256",
			KeySize:  128,
			IsAEAD:   true,
			Strength: StrengthModern,
		},
	}

	got := reg.FilterWeakSuites(suites)
	if len(got) != 1 {
		t.Fatalf("expected one acceptable suite, got %d", len(got))
	}
	if got[0].ID != tls.TLS_AES_128_GCM_SHA256 {
		t.Fatalf("expected modern AES-GCM suite, got %s", got[0].Name)
	}
}
