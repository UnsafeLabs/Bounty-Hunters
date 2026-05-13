package tlscipher

import (
	"crypto/tls"
	"testing"
)

func TestConcurrentLookupUsesSynchronizedCache(t *testing.T) {
	reg := NewSuiteRegistry(StrengthWeak)
	ids := make([]uint16, 100)
	for i := range ids {
		if i%2 == 0 {
			ids[i] = tls.TLS_AES_128_GCM_SHA256
		} else {
			ids[i] = tls.TLS_CHACHA20_POLY1305_SHA256
		}
	}

	results, err := reg.ConcurrentLookup(ids)
	if err != nil {
		t.Fatalf("expected concurrent lookup to succeed: %v", err)
	}
	if len(results) != len(ids) {
		t.Fatalf("expected %d results, got %d", len(ids), len(results))
	}
	if got := reg.lookupSuite(tls.TLS_AES_128_GCM_SHA256); got == nil || got.Name != "TLS_AES_128_GCM_SHA256" {
		t.Fatalf("cached lookup returned wrong suite: %#v", got)
	}
}
