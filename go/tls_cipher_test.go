package tlscipher

import (
	"crypto/tls"
	"testing"
)

func TestFilterWeakSuitesRejectsBrokenAlgorithms(t *testing.T) {
	registry := NewSuiteRegistry(StrengthWeak)
	filtered := registry.FilterWeakSuites(registry.knownSuites)

	for _, suite := range filtered {
		if suite.ID == 0x0005 {
			t.Fatalf("RC4 suite was not filtered: %s", suite.Name)
		}
		if suite.ID == 0x000a {
			t.Fatalf("3DES suite was not filtered: %s", suite.Name)
		}
	}
}

func TestFilterWeakSuitesKeepsModernAeadSuite(t *testing.T) {
	registry := NewSuiteRegistry(StrengthWeak)
	filtered := registry.FilterWeakSuites(registry.knownSuites)

	for _, suite := range filtered {
		if suite.ID == tls.TLS_AES_128_GCM_SHA256 {
			return
		}
	}

	t.Fatal("expected TLS_AES_128_GCM_SHA256 to remain after filtering")
}
