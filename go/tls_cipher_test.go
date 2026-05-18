package tlscipher

import (
	"crypto/tls"
	"testing"
)

func TestSortByPreferenceHonorsChaChaOnNoAESNIArchitectures(t *testing.T) {
	reg := NewSuiteRegistry(StrengthWeak)
	suites := []*CipherSuite{
		{
			ID:       tls.TLS_AES_256_GCM_SHA384,
			Name:     "TLS_AES_256_GCM_SHA384",
			KeySize:  256,
			IsAEAD:   true,
			Strength: StrengthAdvanced,
		},
		{
			ID:       tls.TLS_CHACHA20_POLY1305_SHA256,
			Name:     "TLS_CHACHA20_POLY1305_SHA256",
			KeySize:  256,
			IsAEAD:   true,
			Strength: StrengthAdvanced,
		},
	}

	sorted := reg.SortByPreference(suites)
	if len(sorted) != 2 {
		t.Fatalf("unexpected result length: %d", len(sorted))
	}

	if HasAESNI() {
		if sorted[0].Name != "TLS_AES_256_GCM_SHA384" {
			t.Fatalf("expected AES-GCM first on AESNI systems, got %s", sorted[0].Name)
		}
	} else {
		if sorted[0].Name != "TLS_CHACHA20_POLY1305_SHA256" {
			t.Fatalf("expected ChaCha20 first without AESNI, got %s", sorted[0].Name)
		}
	}
}
