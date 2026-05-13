package tlscipher

import (
	"crypto/tls"
	"testing"
)

func TestSortByPreferencePrefersChaChaWithoutAESNI(t *testing.T) {
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

	originalHasAESNI := hasAESNI
	defer func() { hasAESNI = originalHasAESNI }()

	hasAESNI = func() bool { return false }
	sorted := reg.SortByPreference(suites)
	if sorted[0].ID != tls.TLS_CHACHA20_POLY1305_SHA256 {
		t.Fatalf("expected ChaCha first without AES-NI, got %s", sorted[0].Name)
	}

	hasAESNI = func() bool { return true }
	sorted = reg.SortByPreference(suites)
	if sorted[0].ID != tls.TLS_AES_256_GCM_SHA384 {
		t.Fatalf("expected original AES-GCM ordering with AES-NI, got %s", sorted[0].Name)
	}
}
