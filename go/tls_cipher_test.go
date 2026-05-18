package tlscipher

import (
	"crypto/tls"
	"testing"
)

func TestConcurrentLookupReturnsKnownSuites(t *testing.T) {
	reg := NewSuiteRegistry(StrengthWeak)
	ids := []uint16{
		tls.TLS_AES_128_GCM_SHA256,
		tls.TLS_AES_256_GCM_SHA384,
		tls.TLS_CHACHA20_POLY1305_SHA256,
	}

	results, err := reg.ConcurrentLookup(ids)
	if err != nil {
		t.Fatalf("unexpected error from ConcurrentLookup: %v", err)
	}
	if len(results) != len(ids) {
		t.Fatalf("unexpected result length: %d", len(results))
	}
	for i, suite := range results {
		if suite == nil {
			t.Fatalf("result %d was nil", i)
		}
		if suite.ID != ids[i] {
			t.Fatalf("result %d has id 0x%04x, want 0x%04x", i, suite.ID, ids[i])
		}
	}
}
