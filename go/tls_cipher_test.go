package tlscipher

import (
	"crypto/tls"
	"testing"
)

func TestConcurrentLookupUsesCacheWithoutErrors(t *testing.T) {
	registry := NewSuiteRegistry(StrengthWeak)
	ids := make([]uint16, 100)
	for i := range ids {
		ids[i] = tls.TLS_AES_128_GCM_SHA256
	}

	results, err := registry.ConcurrentLookup(ids)

	if err != nil {
		t.Fatalf("ConcurrentLookup returned error: %v", err)
	}
	for i, result := range results {
		if result == nil {
			t.Fatalf("result %d was nil", i)
		}
		if result.Name != "TLS_AES_128_GCM_SHA256" {
			t.Fatalf("result %d used unexpected suite %q", i, result.Name)
		}
	}
}

func TestLookupSuiteCachesKnownSuite(t *testing.T) {
	registry := NewSuiteRegistry(StrengthWeak)

	first := registry.lookupSuite(tls.TLS_AES_128_GCM_SHA256)
	second := registry.lookupSuite(tls.TLS_AES_128_GCM_SHA256)

	if first == nil || second == nil {
		t.Fatal("expected known suite lookup to succeed")
	}
	if first != second {
		t.Fatal("expected repeated lookup to return cached suite pointer")
	}
}
