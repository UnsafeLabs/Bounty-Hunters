package tlscipher

import (
	"crypto/tls"
	"testing"
)

func TestConcurrentLookupIsSafeAndCachesSuites(t *testing.T) {
	reg := NewSuiteRegistry(StrengthWeak)
	ids := make([]uint16, 100)
	for i := range ids {
		if i%2 == 0 {
			ids[i] = tls.TLS_AES_128_GCM_SHA256
		} else {
			ids[i] = tls.TLS_AES_256_GCM_SHA384
		}
	}

	results, err := reg.ConcurrentLookup(ids)

	if err != nil {
		t.Fatalf("expected concurrent lookup to succeed, got error: %v", err)
	}
	for i, suite := range results {
		if suite == nil {
			t.Fatalf("result %d was nil", i)
		}
	}
	if got := reg.lookupSuite(tls.TLS_AES_128_GCM_SHA256); got == nil || got.Name != "TLS_AES_128_GCM_SHA256" {
		t.Fatalf("expected cached TLS_AES_128_GCM_SHA256 lookup, got %#v", got)
	}
}
