package tlscipher

import (
	"crypto/tls"
	"testing"
)

func setAESNIForTest(t *testing.T, enabled bool) {
	t.Helper()
	orig := hasAESNI
	hasAESNI = func() bool { return enabled }
	t.Cleanup(func() { hasAESNI = orig })
}

func TestNegotiateSuiteReturnsErrorWhenNoSuiteMatches(t *testing.T) {
	reg := NewSuiteRegistry(StrengthWeak)

	name, err := reg.NegotiateSuite([]uint16{0xffff})

	if err == nil {
		t.Fatal("expected a no-match error")
	}
	if name != "" {
		t.Fatalf("expected empty suite name on error, got %q", name)
	}
}

func TestNegotiateSuiteReturnsValidSuiteName(t *testing.T) {
	reg := NewSuiteRegistry(StrengthWeak)

	name, err := reg.NegotiateSuite([]uint16{tls.TLS_AES_128_GCM_SHA256})

	if err != nil {
		t.Fatalf("expected valid suite negotiation, got error: %v", err)
	}
	if name != "TLS_AES_128_GCM_SHA256" {
		t.Fatalf("expected TLS_AES_128_GCM_SHA256, got %q", name)
	}
}

func TestFilterWeakSuitesRejectsBrokenAlgorithms(t *testing.T) {
	reg := NewSuiteRegistry(StrengthWeak)

	filtered := reg.FilterWeakSuites(reg.knownSuites)
	seen := make(map[string]bool, len(filtered))
	for _, suite := range filtered {
		seen[suite.Name] = true
	}

	if seen["TLS_RSA_WITH_RC4_128_SHA"] {
		t.Fatal("expected RC4 suite to be filtered")
	}
	if seen["TLS_RSA_WITH_3DES_EDE_CBC_SHA"] {
		t.Fatal("expected 3DES suite to be filtered")
	}
	if !seen["TLS_AES_128_GCM_SHA256"] {
		t.Fatal("expected modern AEAD suite to remain")
	}
}

func TestSortByPreferencePutsAEADBeforeNonAEAD(t *testing.T) {
	setAESNIForTest(t, true)
	reg := NewSuiteRegistry(StrengthWeak)

	suites := []*CipherSuite{
		suiteByID(t, reg, tls.TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA256),
		suiteByID(t, reg, tls.TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256),
	}

	sorted := reg.SortByPreference(suites)

	if sorted[0].ID != tls.TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256 {
		t.Fatalf("expected AEAD suite first, got %s", sorted[0].Name)
	}
}

func TestSortByPreferenceKeepsAdvancedBeforeModernAEAD(t *testing.T) {
	setAESNIForTest(t, true)
	reg := NewSuiteRegistry(StrengthWeak)

	suites := []*CipherSuite{
		suiteByID(t, reg, tls.TLS_AES_128_GCM_SHA256),
		suiteByID(t, reg, tls.TLS_AES_256_GCM_SHA384),
	}

	sorted := reg.SortByPreference(suites)

	if sorted[0].ID != tls.TLS_AES_256_GCM_SHA384 {
		t.Fatalf("expected advanced AEAD suite first, got %s", sorted[0].Name)
	}
}

func TestSortByPreferencePrefersChaChaWithoutAESNI(t *testing.T) {
	setAESNIForTest(t, false)
	reg := NewSuiteRegistry(StrengthWeak)

	suites := []*CipherSuite{
		suiteByID(t, reg, tls.TLS_AES_256_GCM_SHA384),
		suiteByID(t, reg, tls.TLS_CHACHA20_POLY1305_SHA256),
	}

	sorted := reg.SortByPreference(suites)

	if sorted[0].ID != tls.TLS_CHACHA20_POLY1305_SHA256 {
		t.Fatalf("expected ChaCha20 first without AES-NI, got %s", sorted[0].Name)
	}
}

func TestSortByPreferencePreservesAESOrderWithAESNI(t *testing.T) {
	setAESNIForTest(t, true)
	reg := NewSuiteRegistry(StrengthWeak)

	suites := []*CipherSuite{
		suiteByID(t, reg, tls.TLS_AES_256_GCM_SHA384),
		suiteByID(t, reg, tls.TLS_CHACHA20_POLY1305_SHA256),
	}

	sorted := reg.SortByPreference(suites)

	if sorted[0].ID != tls.TLS_AES_256_GCM_SHA384 {
		t.Fatalf("expected AES ordering to remain with AES-NI, got %s", sorted[0].Name)
	}
}

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

func suiteByID(t *testing.T, reg *SuiteRegistry, id uint16) *CipherSuite {
	t.Helper()
	suite := reg.lookupSuite(id)
	if suite == nil {
		t.Fatalf("missing test fixture suite 0x%04x", id)
	}
	return suite
}
