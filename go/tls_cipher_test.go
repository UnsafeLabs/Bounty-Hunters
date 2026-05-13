package tlscipher

import "testing"

func TestSortByPreferencePrefersAEADOverNonAEAD(t *testing.T) {
	reg := NewSuiteRegistry(StrengthWeak)

	aead := &CipherSuite{
		Name:     "TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256",
		IsAEAD:   true,
		Strength: StrengthModern,
		KeySize:  128,
	}
	nonAEAD := &CipherSuite{
		Name:     "TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA256",
		IsAEAD:   false,
		Strength: StrengthLegacy,
		KeySize:  128,
	}

	sorted := reg.SortByPreference([]*CipherSuite{nonAEAD, aead})
	if len(sorted) != 2 {
		t.Fatalf("expected 2 suites, got %d", len(sorted))
	}
	if sorted[0] != aead {
		t.Fatalf("expected AEAD suite first, got %q", sorted[0].Name)
	}
}

func TestSortByPreferenceOrdersStrengthWithinAEAD(t *testing.T) {
	reg := NewSuiteRegistry(StrengthWeak)

	modern := &CipherSuite{
		Name:     "TLS_AES_128_GCM_SHA256",
		IsAEAD:   true,
		Strength: StrengthModern,
		KeySize:  128,
	}
	advanced := &CipherSuite{
		Name:     "TLS_AES_256_GCM_SHA384",
		IsAEAD:   true,
		Strength: StrengthAdvanced,
		KeySize:  256,
	}

	sorted := reg.SortByPreference([]*CipherSuite{modern, advanced})
	if len(sorted) != 2 {
		t.Fatalf("expected 2 suites, got %d", len(sorted))
	}
	if sorted[0] != advanced {
		t.Fatalf("expected StrengthAdvanced suite first, got %q", sorted[0].Name)
	}
}
