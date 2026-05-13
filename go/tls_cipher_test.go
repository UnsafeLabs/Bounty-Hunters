package tlscipher

import "testing"

func TestFilterWeakSuitesRejectsRC4And3DES(t *testing.T) {
	registry := NewSuiteRegistry(StrengthWeak)

	filtered := registry.FilterWeakSuites(registry.knownSuites)
	names := make(map[string]bool, len(filtered))
	for _, suite := range filtered {
		names[suite.Name] = true
	}

	if names["TLS_RSA_WITH_RC4_128_SHA"] {
		t.Fatal("RC4 suite should be filtered even with a 128-bit key")
	}
	if names["TLS_RSA_WITH_3DES_EDE_CBC_SHA"] {
		t.Fatal("3DES suite should be filtered even with a 168-bit key")
	}
	if !names["TLS_AES_128_GCM_SHA256"] {
		t.Fatal("modern TLS_AES_128_GCM_SHA256 suite should remain allowed")
	}
}
