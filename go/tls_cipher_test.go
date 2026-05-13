package tlscipher

import (
	"crypto/tls"
	"testing"
)

func TestSortByPreferencePrefersAEADBeforeCBC(t *testing.T) {
	reg := NewSuiteRegistry(StrengthModern)

	sorted := reg.SortByPreference([]*CipherSuite{
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
	})

	if !sorted[0].IsAEAD {
		t.Fatalf("expected AEAD suite first, got %s", sorted[0].Name)
	}
}
