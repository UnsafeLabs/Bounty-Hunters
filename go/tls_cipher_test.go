package tlscipher

import (
	"crypto/tls"
	"testing"
)

func TestFilterWeakSuitesRejectsRC4And3DES(t *testing.T) {
	reg := NewSuiteRegistry(StrengthModern)

	filtered := reg.FilterWeakSuites([]*CipherSuite{
		{
			ID:      0x0005,
			Name:    "TLS_RSA_WITH_RC4_128_SHA",
			KeySize: 128,
		},
		{
			ID:      0x000a,
			Name:    "TLS_RSA_WITH_3DES_EDE_CBC_SHA",
			KeySize: 168,
		},
		{
			ID:      tls.TLS_AES_128_GCM_SHA256,
			Name:    "TLS_AES_128_GCM_SHA256",
			KeySize: 128,
			IsAEAD:  true,
		},
	})

	if len(filtered) != 1 {
		t.Fatalf("expected one modern suite to remain, got %d", len(filtered))
	}
	if filtered[0].ID != tls.TLS_AES_128_GCM_SHA256 {
		t.Fatalf("expected AES-GCM suite to remain, got %s", filtered[0].Name)
	}
}
