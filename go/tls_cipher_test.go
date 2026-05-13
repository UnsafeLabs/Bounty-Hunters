package tlscipher

import (
	"crypto/tls"
	"testing"
)

func containsSuite(suites []*CipherSuite, id uint16) bool {
	for _, suite := range suites {
		if suite.ID == id {
			return true
		}
	}
	return false
}

func TestFilterWeakSuitesRemovesRC4And3DES(t *testing.T) {
	registry := NewSuiteRegistry(StrengthWeak)

	filtered := registry.FilterWeakSuites(registry.knownSuites)

	if containsSuite(filtered, 0x0005) {
		t.Fatal("expected TLS_RSA_WITH_RC4_128_SHA to be filtered")
	}
	if containsSuite(filtered, 0x000a) {
		t.Fatal("expected TLS_RSA_WITH_3DES_EDE_CBC_SHA to be filtered")
	}
	if !containsSuite(filtered, tls.TLS_AES_128_GCM_SHA256) {
		t.Fatal("expected TLS_AES_128_GCM_SHA256 to remain")
	}
}
