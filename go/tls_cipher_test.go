package tlscipher

import (
	"crypto/tls"
	"testing"
)

func TestConcurrentLookupProtectsSuiteCache(t *testing.T) {
	registry := NewSuiteRegistry(StrengthWeak)
	ids := make([]uint16, 100)
	for i := range ids {
		ids[i] = tls.TLS_AES_128_GCM_SHA256
	}

	results, err := registry.ConcurrentLookup(ids)

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(results) != len(ids) {
		t.Fatalf("expected %d results, got %d", len(ids), len(results))
	}
	for i, suite := range results {
		if suite == nil || suite.ID != tls.TLS_AES_128_GCM_SHA256 {
			t.Fatalf("unexpected suite at index %d: %#v", i, suite)
		}
	}
}

func TestLookupSuiteUsesCacheForKnownSuite(t *testing.T) {
	registry := NewSuiteRegistry(StrengthWeak)

	first := registry.lookupSuite(tls.TLS_AES_128_GCM_SHA256)
	second := registry.lookupSuite(tls.TLS_AES_128_GCM_SHA256)

	if first == nil {
		t.Fatal("expected suite lookup to succeed")
	}
	if first != second {
		t.Fatal("expected repeated lookup to return cached suite pointer")
	}
}
