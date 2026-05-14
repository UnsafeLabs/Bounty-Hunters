package tlscipher

import (
	"crypto/tls"
	"testing"
)

func TestFilterWeakSuitesRejectsRC4And3DES(t *testing.T) {
	reg := NewSuiteRegistry(StrengthWeak)

	filtered := reg.FilterWeakSuites(reg.knownSuites)

	if containsSuiteID(filtered, 0x0005) {
		t.Fatal("expected TLS_RSA_WITH_RC4_128_SHA to be filtered")
	}
	if containsSuiteID(filtered, 0x000a) {
		t.Fatal("expected TLS_RSA_WITH_3DES_EDE_CBC_SHA to be filtered")
	}
	if !containsSuiteID(filtered, tls.TLS_AES_128_GCM_SHA256) {
		t.Fatal("expected TLS_AES_128_GCM_SHA256 to remain allowed")
	}
}

func containsSuiteID(suites []*CipherSuite, id uint16) bool {
	for _, suite := range suites {
		if suite.ID == id {
			return true
		}
	}
	return false
}
