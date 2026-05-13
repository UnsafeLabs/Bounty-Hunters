package tlscipher

import (
	"crypto/tls"
	"testing"
)

func TestSortByPreferencePutsAEADBeforeNonAEAD(t *testing.T) {
	reg := NewSuiteRegistry(StrengthWeak)

	suites := []*CipherSuite{
		suiteByIDForIssue14Test(t, reg, tls.TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA256),
		suiteByIDForIssue14Test(t, reg, tls.TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256),
	}

	sorted := reg.SortByPreference(suites)

	if sorted[0].ID != tls.TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256 {
		t.Fatalf("expected AEAD suite first, got %s", sorted[0].Name)
	}
}

func TestSortByPreferenceKeepsAdvancedBeforeModernAEAD(t *testing.T) {
	reg := NewSuiteRegistry(StrengthWeak)

	suites := []*CipherSuite{
		suiteByIDForIssue14Test(t, reg, tls.TLS_AES_128_GCM_SHA256),
		suiteByIDForIssue14Test(t, reg, tls.TLS_AES_256_GCM_SHA384),
	}

	sorted := reg.SortByPreference(suites)

	if sorted[0].ID != tls.TLS_AES_256_GCM_SHA384 {
		t.Fatalf("expected advanced AEAD suite first, got %s", sorted[0].Name)
	}
}

func suiteByIDForIssue14Test(t *testing.T, reg *SuiteRegistry, id uint16) *CipherSuite {
	t.Helper()
	suite := reg.lookupSuite(id)
	if suite == nil {
		t.Fatalf("missing test fixture suite 0x%04x", id)
	}
	return suite
}
