package tlscipher

import (
	"crypto/tls"
	"testing"
)

func TestSortByPreferencePrefersChaCha20OnARM64(t *testing.T) {
	registry := NewSuiteRegistry(StrengthWeak)

	ordered := registry.sortByPreferenceForArch(
		registry.FilterWeakSuites(registry.knownSuites),
		"arm64",
	)

	if indexOfSuite(ordered, tls.TLS_CHACHA20_POLY1305_SHA256) >
		indexOfSuite(ordered, tls.TLS_AES_256_GCM_SHA384) {
		t.Fatal("expected ChaCha20-Poly1305 to be preferred over AES-GCM on arm64")
	}
}

func TestSortByPreferenceKeepsAESPreferenceOnAMD64(t *testing.T) {
	registry := NewSuiteRegistry(StrengthWeak)

	ordered := registry.sortByPreferenceForArch(
		registry.FilterWeakSuites(registry.knownSuites),
		"amd64",
	)

	if indexOfSuite(ordered, tls.TLS_AES_256_GCM_SHA384) >
		indexOfSuite(ordered, tls.TLS_CHACHA20_POLY1305_SHA256) {
		t.Fatal("expected AES-GCM to keep preference over ChaCha20-Poly1305 on amd64")
	}
}

func indexOfSuite(suites []*CipherSuite, id uint16) int {
	for index, suite := range suites {
		if suite.ID == id {
			return index
		}
	}
	return len(suites)
}
