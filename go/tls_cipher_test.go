package tlscipher

import (
	"crypto/tls"
	"testing"
)

func TestSortByPreference_AEADRanksAboveNonAEAD(t *testing.T) {
	reg := NewSuiteRegistry(StrengthLegacy)

	aead := &CipherSuite{
		ID:       tls.TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256,
		Name:     "TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256",
		KeySize:  128,
		IsAEAD:   true,
		Strength: StrengthModern,
	}
	nonAEAD := &CipherSuite{
		ID:       tls.TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA256,
		Name:     "TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA256",
		KeySize:  128,
		IsAEAD:   false,
		Strength: StrengthLegacy,
	}

	sorted := reg.SortByPreference([]*CipherSuite{nonAEAD, aead})
	if len(sorted) != 2 {
		t.Fatalf("expected 2 suites, got %d", len(sorted))
	}
	if !sorted[0].IsAEAD {
		t.Fatalf("expected AEAD suite first, got %q (IsAEAD=%v)", sorted[0].Name, sorted[0].IsAEAD)
	}
	if sorted[0].Name != aead.Name {
		t.Errorf("expected %q first, got %q", aead.Name, sorted[0].Name)
	}
	if sorted[1].Name != nonAEAD.Name {
		t.Errorf("expected %q second, got %q", nonAEAD.Name, sorted[1].Name)
	}
}

func TestSortByPreference_AmongAEADStrengthAdvancedAboveModern(t *testing.T) {
	reg := NewSuiteRegistry(StrengthLegacy)

	modern := &CipherSuite{
		ID:       tls.TLS_AES_128_GCM_SHA256,
		Name:     "TLS_AES_128_GCM_SHA256",
		KeySize:  128,
		IsAEAD:   true,
		Strength: StrengthModern,
	}
	advanced := &CipherSuite{
		ID:       tls.TLS_AES_256_GCM_SHA384,
		Name:     "TLS_AES_256_GCM_SHA384",
		KeySize:  256,
		IsAEAD:   true,
		Strength: StrengthAdvanced,
	}

	sorted := reg.SortByPreference([]*CipherSuite{modern, advanced})
	if sorted[0].Strength != StrengthAdvanced {
		t.Fatalf("expected StrengthAdvanced first, got %v (%s)", sorted[0].Strength, sorted[0].Name)
	}
	if sorted[1].Strength != StrengthModern {
		t.Fatalf("expected StrengthModern second, got %v (%s)", sorted[1].Strength, sorted[1].Name)
	}
}

func TestSortByPreference_DefaultsKeepAEADBeforeLegacy(t *testing.T) {
	reg := NewSuiteRegistry(StrengthLegacy)

	sorted := reg.SortByPreference(reg.knownSuites)

	seenNonAEAD := false
	for _, s := range sorted {
		if !s.IsAEAD {
			seenNonAEAD = true
			continue
		}
		if seenNonAEAD {
			t.Fatalf("AEAD suite %q appeared after a non-AEAD suite", s.Name)
		}
	}
}
