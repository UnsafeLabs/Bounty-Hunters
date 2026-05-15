package tlscipher

import "testing"

func TestSortByPreferencePrefersChaChaWithoutAESNI(t *testing.T) {
	original := hasAESNI
	hasAESNI = func() bool { return false }
	defer func() { hasAESNI = original }()

	registry := NewSuiteRegistry(StrengthWeak)
	aes := &CipherSuite{Name: "TLS_AES_256_GCM_SHA384", KeySize: 256, IsAEAD: true, Strength: StrengthAdvanced}
	chacha := &CipherSuite{Name: "TLS_CHACHA20_POLY1305_SHA256", KeySize: 256, IsAEAD: true, Strength: StrengthAdvanced}

	sorted := registry.SortByPreference([]*CipherSuite{aes, chacha})
	if sorted[0] != chacha {
		t.Fatal("expected ChaCha20 suite to sort first when AES-NI is unavailable")
	}
}

func TestSortByPreferencePreservesAESOrderWithAESNI(t *testing.T) {
	original := hasAESNI
	hasAESNI = func() bool { return true }
	defer func() { hasAESNI = original }()

	registry := NewSuiteRegistry(StrengthWeak)
	aes := &CipherSuite{Name: "TLS_AES_256_GCM_SHA384", KeySize: 256, IsAEAD: true, Strength: StrengthAdvanced}
	chacha := &CipherSuite{Name: "TLS_CHACHA20_POLY1305_SHA256", KeySize: 256, IsAEAD: true, Strength: StrengthAdvanced}

	sorted := registry.SortByPreference([]*CipherSuite{aes, chacha})
	if sorted[0] != aes {
		t.Fatal("expected existing same-strength order to remain when AES-NI is available")
	}
}