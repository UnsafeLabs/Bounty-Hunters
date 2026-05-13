package tlscipher

import (
	"crypto/tls"
	"testing"
)

func TestSortByPreferencePrefersAEADOverNonAEAD(t *testing.T) {
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
	}

	got := reg.SortByPreference(suites)
	if got[0].ID != tls.TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256 {
		t.Fatalf("expected AEAD suite first, got %s", got[0].Name)
	}
}

func TestSortByPreferenceOrdersAEADByStrength(t *testing.T) {
	reg := NewSuiteRegistry(StrengthWeak)
	suites := []*CipherSuite{
		{
			ID:       tls.TLS_AES_128_GCM_SHA256,
			Name:     "TLS_AES_128_GCM_SHA256",
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

	got := reg.SortByPreference(suites)
	if got[0].ID != tls.TLS_AES_256_GCM_SHA384 {
		t.Fatalf("expected stronger AEAD suite first, got %s", got[0].Name)
	}
}
