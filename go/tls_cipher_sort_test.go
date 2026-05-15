package tlscipher

import "testing"

func TestSortByPreferencePrefersAEADSuites(t *testing.T) {
	registry := NewSuiteRegistry(StrengthWeak)
	aead := &CipherSuite{Name: "aead", KeySize: 128, IsAEAD: true, Strength: StrengthModern}
	nonAEAD := &CipherSuite{Name: "cbc", KeySize: 256, IsAEAD: false, Strength: StrengthAdvanced}

	sorted := registry.SortByPreference([]*CipherSuite{nonAEAD, aead})
	if sorted[0] != aead {
		t.Fatal("expected AEAD suite to sort before non-AEAD suite")
	}
}

func TestSortByPreferenceKeepsStrengthOrderWithinAEAD(t *testing.T) {
	registry := NewSuiteRegistry(StrengthWeak)
	modern := &CipherSuite{Name: "modern", KeySize: 256, IsAEAD: true, Strength: StrengthModern}
	advanced := &CipherSuite{Name: "advanced", KeySize: 128, IsAEAD: true, Strength: StrengthAdvanced}

	sorted := registry.SortByPreference([]*CipherSuite{modern, advanced})
	if sorted[0] != advanced {
		t.Fatal("expected higher-strength AEAD suite to sort first")
	}
}