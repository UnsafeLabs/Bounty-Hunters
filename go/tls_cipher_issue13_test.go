package tlscipher

import "testing"

func TestFilterWeakSuitesRejectsRC4And3DES(t *testing.T) {
	reg := NewSuiteRegistry(StrengthWeak)

	filtered := reg.FilterWeakSuites(reg.knownSuites)
	seen := make(map[string]bool, len(filtered))
	for _, suite := range filtered {
		seen[suite.Name] = true
	}

	if seen["TLS_RSA_WITH_RC4_128_SHA"] {
		t.Fatal("expected RC4 suite to be filtered")
	}
	if seen["TLS_RSA_WITH_3DES_EDE_CBC_SHA"] {
		t.Fatal("expected 3DES suite to be filtered")
	}
	if !seen["TLS_AES_128_GCM_SHA256"] {
		t.Fatal("expected modern AEAD suite to remain")
	}
}
