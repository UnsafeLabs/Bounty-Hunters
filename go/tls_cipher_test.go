package tlscipher

import (
	"crypto/tls"
	"testing"
)

func TestFilterWeakSuites_RemovesRC4(t *testing.T) {
	reg := NewSuiteRegistry(StrengthWeak)
	rc4Suite := &CipherSuite{ID: 0x0005, Name: "TLS_RSA_WITH_RC4_128_SHA", KeySize: 128}
	aeadSuite := &CipherSuite{ID: tls.TLS_AES_128_GCM_SHA256, Name: "TLS_AES_128_GCM_SHA256", KeySize: 128, IsAEAD: true}
	result := reg.FilterWeakSuites([]*CipherSuite{rc4Suite, aeadSuite})
	for _, s := range result {
		if s.Name == "TLS_RSA_WITH_RC4_128_SHA" {
			t.Error("RC4 suite should be filtered out")
		}
	}
	if len(result) != 1 || result[0].Name != "TLS_AES_128_GCM_SHA256" {
		t.Errorf("expected only AEAD suite, got %v", result)
	}
}

func TestFilterWeakSuites_Removes3DES(t *testing.T) {
	reg := NewSuiteRegistry(StrengthWeak)
	des3Suite := &CipherSuite{ID: 0x000a, Name: "TLS_RSA_WITH_3DES_EDE_CBC_SHA", KeySize: 168}
	aeadSuite := &CipherSuite{ID: tls.TLS_AES_128_GCM_SHA256, Name: "TLS_AES_128_GCM_SHA256", KeySize: 128, IsAEAD: true}
	result := reg.FilterWeakSuites([]*CipherSuite{des3Suite, aeadSuite})
	for _, s := range result {
		if s.Name == "TLS_RSA_WITH_3DES_EDE_CBC_SHA" {
			t.Error("3DES suite should be filtered out")
		}
	}
}

func TestFilterWeakSuites_KeepsAEAD(t *testing.T) {
	reg := NewSuiteRegistry(StrengthWeak)
	aeadSuite := &CipherSuite{ID: tls.TLS_AES_128_GCM_SHA256, Name: "TLS_AES_128_GCM_SHA256", KeySize: 128, IsAEAD: true}
	result := reg.FilterWeakSuites([]*CipherSuite{aeadSuite})
	if len(result) != 1 {
		t.Errorf("AEAD suite with KeySize 128 should be kept, got %d results", len(result))
	}
}
