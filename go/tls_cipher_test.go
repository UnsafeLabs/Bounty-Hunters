package tlscipher

import (
	"crypto/tls"
	"sync"
	"testing"
)

func TestNegotiateSuiteReturnsErrorWhenNoSuiteMatches(t *testing.T) {
	reg := NewSuiteRegistry(StrengthModern)

	name, err := reg.NegotiateSuite([]uint16{0xffff})
	if err == nil {
		t.Fatal("expected unsupported client suite to return an error")
	}
	if name != "" {
		t.Fatalf("expected no selected suite, got %q", name)
	}
}

func TestNegotiateSuiteKeepsValidSuite(t *testing.T) {
	reg := NewSuiteRegistry(StrengthModern)

	name, err := reg.NegotiateSuite([]uint16{tls.TLS_AES_128_GCM_SHA256})
	if err != nil {
		t.Fatalf("expected valid suite to negotiate: %v", err)
	}
	if name != "TLS_AES_128_GCM_SHA256" {
		t.Fatalf("unexpected suite %q", name)
	}
}

func TestSortByPreferencePrefersChaCha20WithoutAESNI(t *testing.T) {
	original := hasAESNI
	hasAESNI = func() bool { return false }
	defer func() { hasAESNI = original }()

	reg := NewSuiteRegistry(StrengthModern)

	sorted := reg.SortByPreference([]*CipherSuite{
		{
			ID:       tls.TLS_AES_256_GCM_SHA384,
			Name:     "TLS_AES_256_GCM_SHA384",
			KeySize:  256,
			IsAEAD:   true,
			Strength: StrengthAdvanced,
		},
		{
			ID:       tls.TLS_CHACHA20_POLY1305_SHA256,
			Name:     "TLS_CHACHA20_POLY1305_SHA256",
			KeySize:  256,
			IsAEAD:   true,
			Strength: StrengthAdvanced,
		},
	})

	if sorted[0].ID != tls.TLS_CHACHA20_POLY1305_SHA256 {
		t.Fatalf("expected ChaCha20 first without AES-NI, got %s", sorted[0].Name)
	}
}

func TestSortByPreferencePreservesAESPreferenceWithAESNI(t *testing.T) {
	original := hasAESNI
	hasAESNI = func() bool { return true }
	defer func() { hasAESNI = original }()

	reg := NewSuiteRegistry(StrengthModern)

	sorted := reg.SortByPreference([]*CipherSuite{
		{
			ID:       tls.TLS_AES_256_GCM_SHA384,
			Name:     "TLS_AES_256_GCM_SHA384",
			KeySize:  256,
			IsAEAD:   true,
			Strength: StrengthAdvanced,
		},
		{
			ID:       tls.TLS_CHACHA20_POLY1305_SHA256,
			Name:     "TLS_CHACHA20_POLY1305_SHA256",
			KeySize:  256,
			IsAEAD:   true,
			Strength: StrengthAdvanced,
		},
	})

	if sorted[0].ID != tls.TLS_AES_256_GCM_SHA384 {
		t.Fatalf("expected original AES-first ordering with AES-NI, got %s", sorted[0].Name)
	}
}

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

func TestSortByPreferencePrefersAEADBeforeCBC(t *testing.T) {
	reg := NewSuiteRegistry(StrengthModern)

	sorted := reg.SortByPreference([]*CipherSuite{
		{
			ID:       tls.TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA256,
			Name:     "TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA256",
			KeySize:  128,
			IsAEAD:   false,
			Strength: StrengthLegacy,
		},
		{
			ID:       tls.TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256,
			Name:     "TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256",
			KeySize:  128,
			IsAEAD:   true,
			Strength: StrengthModern,
		},
	})

	if !sorted[0].IsAEAD {
		t.Fatalf("expected AEAD suite first, got %s", sorted[0].Name)
	}
}

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
