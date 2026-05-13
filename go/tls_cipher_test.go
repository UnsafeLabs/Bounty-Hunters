package tlscipher

import "testing"

func TestSortByPreferenceRanksAeadBeforeNonAead(t *testing.T) {
	registry := NewSuiteRegistry(StrengthWeak)
	sorted := registry.SortByPreference([]*CipherSuite{
		{
			ID:       0x003c,
			Name:     "TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA256",
			KeySize:  128,
			IsAEAD:   false,
			Strength: StrengthModern,
		},
		{
			ID:       0xc02b,
			Name:     "TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256",
			KeySize:  128,
			IsAEAD:   true,
			Strength: StrengthModern,
		},
	})

	if !sorted[0].IsAEAD {
		t.Fatalf("expected AEAD suite first, got %s", sorted[0].Name)
	}
}

func TestSortByPreferenceKeepsStrengthOrderingWithinAead(t *testing.T) {
	registry := NewSuiteRegistry(StrengthWeak)
	sorted := registry.SortByPreference([]*CipherSuite{
		{
			ID:       0x1301,
			Name:     "TLS_AES_128_GCM_SHA256",
			KeySize:  128,
			IsAEAD:   true,
			Strength: StrengthModern,
		},
		{
			ID:       0x1302,
			Name:     "TLS_AES_256_GCM_SHA384",
			KeySize:  256,
			IsAEAD:   true,
			Strength: StrengthAdvanced,
		},
	})

	if sorted[0].Strength != StrengthAdvanced {
		t.Fatalf("expected advanced AEAD suite first, got %s", sorted[0].Name)
	}
}
