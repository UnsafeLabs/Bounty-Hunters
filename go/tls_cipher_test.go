package tlscipher

import (
	"crypto/tls"
	"testing"
)

func TestSortByPreference_AEADBeforeNonAEAD(t *testing.T) {
	reg := NewSuiteRegistry(StrengthWeak)
	nonAEAD := &CipherSuite{ID: tls.TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA256, Name: "TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA256", KeySize: 128, IsAEAD: false, Strength: StrengthLegacy}
	aead := &CipherSuite{ID: tls.TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256, Name: "TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256", KeySize: 128, IsAEAD: true, Strength: StrengthModern}
	result := reg.SortByPreference([]*CipherSuite{nonAEAD, aead})
	if len(result) < 2 {
		t.Fatal("expected at least 2 suites")
	}
	if !result[0].IsAEAD {
		t.Errorf("AEAD suite should come first, got %q (IsAEAD=%v)", result[0].Name, result[0].IsAEAD)
	}
}

func TestSortByPreference_StrengthOrderWithinAEAD(t *testing.T) {
	reg := NewSuiteRegistry(StrengthWeak)
	modern := &CipherSuite{ID: tls.TLS_AES_128_GCM_SHA256, Name: "TLS_AES_128_GCM_SHA256", KeySize: 128, IsAEAD: true, Strength: StrengthModern}
	advanced := &CipherSuite{ID: tls.TLS_AES_256_GCM_SHA384, Name: "TLS_AES_256_GCM_SHA384", KeySize: 256, IsAEAD: true, Strength: StrengthAdvanced}
	result := reg.SortByPreference([]*CipherSuite{modern, advanced})
	if len(result) < 2 {
		t.Fatal("expected at least 2 suites")
	}
	if result[0].Strength < result[1].Strength {
		t.Errorf("higher strength AEAD should come first, got %q (%d) before %q (%d)",
			result[0].Name, result[0].Strength, result[1].Name, result[1].Strength)
	}
}
