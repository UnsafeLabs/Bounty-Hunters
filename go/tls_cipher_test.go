package tlscipher

import (
	"crypto/tls"
	"testing"
)

func TestSortByPreferenceRanksAEADBeforeNonAEAD(t *testing.T) {
	registry := NewSuiteRegistry(StrengthWeak)
	nonAEAD := registry.lookupSuite(tls.TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA256)
	aead := registry.lookupSuite(tls.TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256)

	sorted := registry.SortByPreference([]*CipherSuite{nonAEAD, aead})

	if sorted[0].ID != aead.ID {
		t.Fatalf("expected AEAD suite first, got %s", sorted[0].Name)
	}
}

func TestSortByPreferenceKeepsStrengthOrderingAmongAEAD(t *testing.T) {
	registry := NewSuiteRegistry(StrengthWeak)
	modern := registry.lookupSuite(tls.TLS_AES_128_GCM_SHA256)
	advanced := registry.lookupSuite(tls.TLS_AES_256_GCM_SHA384)

	sorted := registry.SortByPreference([]*CipherSuite{modern, advanced})

	if sorted[0].ID != advanced.ID {
		t.Fatalf("expected advanced AEAD suite first, got %s", sorted[0].Name)
	}
}
