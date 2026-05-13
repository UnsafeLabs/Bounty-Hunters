package tlscipher

import (
	"crypto/tls"
	"sync"
	"testing"
)

func TestConcurrentLookupDoesNotRaceOrFail(t *testing.T) {
	reg := NewSuiteRegistry(StrengthModern)
	ids := []uint16{
		tls.TLS_AES_128_GCM_SHA256,
		tls.TLS_AES_256_GCM_SHA384,
		tls.TLS_CHACHA20_POLY1305_SHA256,
		tls.TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256,
	}

	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := reg.ConcurrentLookup(ids); err != nil {
				t.Errorf("ConcurrentLookup returned error: %v", err)
			}
		}()
	}
	wg.Wait()
}
