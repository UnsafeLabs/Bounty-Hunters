package tlscipher

import (
	"crypto/tls"
	"sync"
	"testing"
)

func TestConcurrentLookupIsRaceSafe(t *testing.T) {
	registry := NewSuiteRegistry(StrengthLegacy)
	ids := []uint16{
		tls.TLS_AES_128_GCM_SHA256,
		tls.TLS_AES_256_GCM_SHA384,
		tls.TLS_CHACHA20_POLY1305_SHA256,
		tls.TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256,
		tls.TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384,
	}

	var wg sync.WaitGroup
	for i := 0; i < 64; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			results, err := registry.ConcurrentLookup(ids)
			if err != nil {
				t.Errorf("ConcurrentLookup returned error: %v", err)
				return
			}
			if len(results) != len(ids) {
				t.Errorf("got %d results, want %d", len(results), len(ids))
			}
		}()
	}
	wg.Wait()
}
