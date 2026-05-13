package tlscipher

import (
	"crypto/tls"
	"testing"
)

func TestSortByPreferencePrefersChaCha20WithoutAESNI(t *testing.T) {
	original := hasAESNI
	hasAESNI = func() bool { return false }
	defer func() { hasAESNI = original }()

	reg := NewSuiteRegistry(StrengthModern)

	sorted := reg.SortByPreference([]*CipherSuite{
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
	})

	if sorted[0].ID != tls.TLS_CHACHA20_POLY1305_SHA256 {
		t.Fatalf("expected ChaCha20 first without AES-NI, got %s", sorted[0].Name)
	}
}

func TestSortByPreferencePreservesAESPreferenceWithAESNI(t *testing.T) {
	original := hasAESNI
	hasAESNI = func() bool { return true }
	defer func() { hasAESNI = original }()

	reg := NewSuiteRegistry(StrengthModern)

	sorted := reg.SortByPreference([]*CipherSuite{
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
	})

	if sorted[0].ID != tls.TLS_AES_256_GCM_SHA384 {
		t.Fatalf("expected original AES-first ordering with AES-NI, got %s", sorted[0].Name)
	}
}
