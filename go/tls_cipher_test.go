package tlscipher

import (
	"crypto/tls"
	"runtime"
	"strings"
	"testing"
)

func TestNewSuiteRegistryLoadsDefaultSuites(t *testing.T) {
	registry := NewSuiteRegistry(StrengthWeak)

	names := registry.SuiteNames([]uint16{tls.TLS_AES_128_GCM_SHA256})

	if len(names) != 1 || names[0] != "TLS_AES_128_GCM_SHA256" {
		t.Fatalf("expected TLS_AES_128_GCM_SHA256, got %#v", names)
	}
}

func TestSuiteNamesSkipsUnknownSuites(t *testing.T) {
	registry := NewSuiteRegistry(StrengthWeak)

	names := registry.SuiteNames([]uint16{0xffff, tls.TLS_AES_256_GCM_SHA384})

	if len(names) != 1 || names[0] != "TLS_AES_256_GCM_SHA384" {
		t.Fatalf("expected only known suite name, got %#v", names)
	}
}

func TestNegotiateSuiteReturnsErrorForEmptyClientOffer(t *testing.T) {
	registry := NewSuiteRegistry(StrengthWeak)

	if _, err := registry.NegotiateSuite(nil); err == nil {
		t.Fatal("expected error when client offers no cipher suites")
	}
}

func TestNegotiateSuiteSelectsOnlyOfferedKnownSuite(t *testing.T) {
	registry := NewSuiteRegistry(StrengthWeak)

	name, err := registry.NegotiateSuite([]uint16{tls.TLS_AES_256_GCM_SHA384})

	if err != nil {
		t.Fatalf("expected negotiation to succeed: %v", err)
	}
	if name != "TLS_AES_256_GCM_SHA384" {
		t.Fatalf("expected TLS_AES_256_GCM_SHA384, got %q", name)
	}
}

func TestFilterWeakSuitesDropsSmallKeySuites(t *testing.T) {
	registry := NewSuiteRegistry(StrengthWeak)
	suites := []*CipherSuite{
		{ID: 1, Name: "small", KeySize: 64, Strength: StrengthWeak},
		{ID: 2, Name: "large", KeySize: 128, Strength: StrengthLegacy},
	}

	filtered := registry.FilterWeakSuites(suites)

	if len(filtered) != 1 || filtered[0].Name != "large" {
		t.Fatalf("expected only large key suite, got %#v", filtered)
	}
}

func TestSortByPreferenceOrdersByStrengthWithinSameAeadClass(t *testing.T) {
	registry := NewSuiteRegistry(StrengthWeak)
	suites := []*CipherSuite{
		{ID: 1, Name: "legacy", KeySize: 128, IsAEAD: true, Strength: StrengthLegacy},
		{ID: 2, Name: "advanced", KeySize: 128, IsAEAD: true, Strength: StrengthAdvanced},
	}

	sorted := registry.SortByPreference(suites)

	if sorted[0].Name != "advanced" || sorted[1].Name != "legacy" {
		t.Fatalf("expected higher strength first, got %#v", sorted)
	}
	if suites[0].Name != "legacy" {
		t.Fatal("SortByPreference should not mutate the input slice")
	}
}

func TestConcurrentLookupReturnsSuitesForKnownIds(t *testing.T) {
	registry := NewSuiteRegistry(StrengthWeak)

	suites, err := registry.ConcurrentLookup([]uint16{
		tls.TLS_AES_128_GCM_SHA256,
		tls.TLS_AES_256_GCM_SHA384,
	})

	if err != nil {
		t.Fatalf("expected successful lookup: %v", err)
	}
	if len(suites) != 2 || suites[0] == nil || suites[1] == nil {
		t.Fatalf("expected two looked-up suites, got %#v", suites)
	}
}

func TestConcurrentLookupReportsUnknownSuite(t *testing.T) {
	registry := NewSuiteRegistry(StrengthWeak)

	_, err := registry.ConcurrentLookup([]uint16{0xffff})

	if err == nil || !strings.Contains(err.Error(), "unknown suite") {
		t.Fatalf("expected unknown suite error, got %v", err)
	}
}

func TestFormatSuiteIncludesNameKeyTypeAndVersions(t *testing.T) {
	suite := &CipherSuite{
		ID:            tls.TLS_AES_128_GCM_SHA256,
		Name:          "TLS_AES_128_GCM_SHA256",
		KeySize:       128,
		IsAEAD:        true,
		SupportedVers: []uint16{tls.VersionTLS13},
	}

	formatted := FormatSuite(suite)

	for _, expected := range []string{"TLS_AES_128_GCM_SHA256", "128-bit", "AEAD", "TLS1.3"} {
		if !strings.Contains(formatted, expected) {
			t.Fatalf("expected formatted suite to include %q, got %q", expected, formatted)
		}
	}
}

func TestHasAESNIReflectsAmd64RuntimeHeuristic(t *testing.T) {
	got := HasAESNI()
	want := runtime.GOARCH == "amd64"

	if got != want {
		t.Fatalf("expected HasAESNI=%v for GOARCH=%s, got %v", want, runtime.GOARCH, got)
	}
}
