package tlscipher

import (
	"crypto/tls"
	"testing"
)

func TestSortByPreferenceRanksAEADBeforeNonAEADAndPreservesStrength(t *testing.T) {
	reg := NewSuiteRegistry(StrengthWeak)
	suites := []*CipherSuite{
		{
			ID:       tls.TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA256,
			Name:     "TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA256",
			KeySize:  128,
			IsAEAD:   false,
			Strength: StrengthLegacy,
		},
		{
			ID:       tls.TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256,
			Name:     "TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256",
			KeySize:  128,
			IsAEAD:   true,
			Strength: StrengthModern,
		},
		{
			ID:       tls.TLS_AES_256_GCM_SHA384,
			Name:     "TLS_AES_256_GCM_SHA384",
			KeySize:  256,
			IsAEAD:   true,
			Strength: StrengthAdvanced,
		},
	}

	sorted := reg.SortByPreference(suites)

	if sorted[0].ID != tls.TLS_AES_256_GCM_SHA384 {
		t.Fatalf("expected advanced AEAD first, got %s", sorted[0].Name)
	}
	if sorted[1].ID != tls.TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256 {
		t.Fatalf("expected modern AEAD before non-AEAD, got %s", sorted[1].Name)
	}
	if sorted[2].ID != tls.TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA256 {
		t.Fatalf("expected non-AEAD last, got %s", sorted[2].Name)
	}
}
