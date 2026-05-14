package tlscipher

import (
	"crypto/tls"
	"testing"
)

func TestSortByPreferencePrefersAEADOverNonAEAD(t *testing.T) {
	registry := NewSuiteRegistry(StrengthLegacy)

	nonAEAD := &CipherSuite{
		ID:       tls.TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA256,
		Name:     "TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA256",
		KeySize:  128,
		IsAEAD:   false,
		Strength: StrengthModern,
	}
	aead := &CipherSuite{
		ID:       tls.TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256,
		Name:     "TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256",
		KeySize:  128,
		IsAEAD:   true,
		Strength: StrengthModern,
	}

	sorted := registry.SortByPreference([]*CipherSuite{nonAEAD, aead})

	if got := sorted[0].Name; got != aead.Name {
		t.Fatalf("expected AEAD suite first, got %s", got)
	}
	if got := sorted[1].Name; got != nonAEAD.Name {
		t.Fatalf("expected non-AEAD suite second, got %s", got)
	}
}

func TestSortByPreferenceOrdersAEADByStrengthThenKeySize(t *testing.T) {
	registry := NewSuiteRegistry(StrengthLegacy)

	modern256 := &CipherSuite{
		Name:     "modern-256-aead",
		KeySize:  256,
		IsAEAD:   true,
		Strength: StrengthModern,
	}
	advanced128 := &CipherSuite{
		Name:     "advanced-128-aead",
		KeySize:  128,
		IsAEAD:   true,
		Strength: StrengthAdvanced,
	}
	modern128 := &CipherSuite{
		Name:     "modern-128-aead",
		KeySize:  128,
		IsAEAD:   true,
		Strength: StrengthModern,
	}

	sorted := registry.SortByPreference([]*CipherSuite{modern128, modern256, advanced128})

	want := []string{"advanced-128-aead", "modern-256-aead", "modern-128-aead"}
	for i, name := range want {
		if sorted[i].Name != name {
			t.Fatalf("sorted[%d] = %s, want %s", i, sorted[i].Name, name)
		}
	}
}
