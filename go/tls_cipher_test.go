package tlscipher

import (
	"crypto/tls"
	"testing"
)

func withAESNI(value bool, fn func()) {
	original := hasAESNI
	hasAESNI = func() bool { return value }
	defer func() { hasAESNI = original }()
	fn()
}

func TestSortByPreferencePrefersChaChaWithoutAESNI(t *testing.T) {
	withAESNI(false, func() {
		registry := NewSuiteRegistry(StrengthWeak)
		aes := registry.lookupSuite(tls.TLS_AES_256_GCM_SHA384)
		chacha := registry.lookupSuite(tls.TLS_CHACHA20_POLY1305_SHA256)

		sorted := registry.SortByPreference([]*CipherSuite{aes, chacha})

		if sorted[0].ID != chacha.ID {
			t.Fatalf("expected ChaCha20 first without AES-NI, got %s", sorted[0].Name)
		}
	})
}

func TestSortByPreferencePreservesAESOrderingWithAESNI(t *testing.T) {
	withAESNI(true, func() {
		registry := NewSuiteRegistry(StrengthWeak)
		aes := registry.lookupSuite(tls.TLS_AES_256_GCM_SHA384)
		chacha := registry.lookupSuite(tls.TLS_CHACHA20_POLY1305_SHA256)

		sorted := registry.SortByPreference([]*CipherSuite{aes, chacha})

		if sorted[0].ID != aes.ID {
			t.Fatalf("expected AES-GCM first with AES-NI, got %s", sorted[0].Name)
		}
	})
}
