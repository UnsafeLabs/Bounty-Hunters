package tlscipher

import (
	"crypto/tls"
	"testing"
)

func setAESNIForIssue12Test(t *testing.T, enabled bool) {
	t.Helper()
	orig := hasAESNI
	hasAESNI = func() bool { return enabled }
	t.Cleanup(func() { hasAESNI = orig })
}

func TestSortByPreferencePrefersChaChaWithoutAESNI(t *testing.T) {
	setAESNIForIssue12Test(t, false)
	reg := NewSuiteRegistry(StrengthWeak)

	suites := []*CipherSuite{
		suiteByIDForIssue12Test(t, reg, tls.TLS_AES_256_GCM_SHA384),
		suiteByIDForIssue12Test(t, reg, tls.TLS_CHACHA20_POLY1305_SHA256),
	}

	sorted := reg.SortByPreference(suites)

	if sorted[0].ID != tls.TLS_CHACHA20_POLY1305_SHA256 {
		t.Fatalf("expected ChaCha20 first without AES-NI, got %s", sorted[0].Name)
	}
}

func TestSortByPreferencePreservesAESOrderWithAESNI(t *testing.T) {
	setAESNIForIssue12Test(t, true)
	reg := NewSuiteRegistry(StrengthWeak)

	suites := []*CipherSuite{
		suiteByIDForIssue12Test(t, reg, tls.TLS_AES_256_GCM_SHA384),
		suiteByIDForIssue12Test(t, reg, tls.TLS_CHACHA20_POLY1305_SHA256),
	}

	sorted := reg.SortByPreference(suites)

	if sorted[0].ID != tls.TLS_AES_256_GCM_SHA384 {
		t.Fatalf("expected AES ordering to remain with AES-NI, got %s", sorted[0].Name)
	}
}

func suiteByIDForIssue12Test(t *testing.T, reg *SuiteRegistry, id uint16) *CipherSuite {
	t.Helper()
	suite := reg.lookupSuite(id)
	if suite == nil {
		t.Fatalf("missing test fixture suite 0x%04x", id)
	}
	return suite
}
