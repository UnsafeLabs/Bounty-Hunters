package tlscipher

import (
	"crypto/tls"
	"testing"
)

func TestFilterWeakSuitesRejectsRC4And3DES(t *testing.T) {
	registry := NewSuiteRegistry(StrengthWeak)
	filtered := registry.FilterWeakSuites(registry.knownSuites)

	seen := map[uint16]bool{}
	for _, suite := range filtered {
		seen[suite.ID] = true
	}

	if seen[0x0005] {
		t.Fatal("expected RC4 suite to be filtered")
	}
	if seen[0x000a] {
		t.Fatal("expected 3DES suite to be filtered")
	}
	if !seen[tls.TLS_AES_128_GCM_SHA256] {
		t.Fatal("expected modern AES-GCM suite to remain")
	}
}