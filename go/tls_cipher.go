package tlscipher

import (
	"crypto/tls"
	"errors"
	"fmt"
	"runtime"
	"sort"
	"strings"
	"sync"
)

// CipherStrength represents the security level of a cipher suite.
type CipherStrength int

const (
	StrengthWeak     CipherStrength = iota // Known-broken or deprecated
	StrengthLegacy                         // Acceptable for backward compat only
	StrengthModern                         // Recommended for general use
	StrengthAdvanced                       // Highest security, may cost performance
)

// CipherSuite holds metadata about a single TLS cipher suite.
type CipherSuite struct {
	ID            uint16
	Name          string
	KeySize       int
	IsAEAD        bool
	Strength      CipherStrength
	SupportedVers []uint16 // TLS versions where this suite is valid
}

// Negotiator selects and orders cipher suites for a TLS handshake.
type Negotiator interface {
	NegotiateSuite(clientSuites []uint16) (string, error)
	FilterWeakSuites(suites []*CipherSuite) []*CipherSuite
	SortByPreference(suites []*CipherSuite) []*CipherSuite
}

// SuiteRegistry is the default Negotiator implementation. It maintains
// a registry of known suites and a concurrency-safe lookup cache.
type SuiteRegistry struct {
	knownSuites []*CipherSuite
	minStrength CipherStrength
	preferredID uint16
	suiteCache  map[uint16]*CipherSuite // BUG(5): unprotected shared cache
	mu          sync.Mutex              // guards knownSuites only
}

// NewSuiteRegistry creates a registry pre-loaded with common cipher suites.
func NewSuiteRegistry(minStrength CipherStrength) *SuiteRegistry {
	reg := &SuiteRegistry{
		minStrength: minStrength,
		suiteCache:  make(map[uint16]*CipherSuite),
	}
	reg.loadDefaults()
	return reg
}

// loadDefaults populates the registry with a representative set of suites.
func (r *SuiteRegistry) loadDefaults() {
	r.knownSuites = []*CipherSuite{
		{
			ID:            tls.TLS_AES_128_GCM_SHA256,
			Name:          "TLS_AES_128_GCM_SHA256",
			KeySize:       128,
			IsAEAD:        true,
			Strength:      StrengthModern,
			SupportedVers: []uint16{tls.VersionTLS13},
		},
		{
			ID:            tls.TLS_AES_256_GCM_SHA384,
			Name:          "TLS_AES_256_GCM_SHA384",
			KeySize:       256,
			IsAEAD:        true,
			Strength:      StrengthAdvanced,
			SupportedVers: []uint16{tls.VersionTLS13},
		},
		{
			ID:            tls.TLS_CHACHA20_POLY1305_SHA256,
			Name:          "TLS_CHACHA20_POLY1305_SHA256",
			KeySize:       256,
			IsAEAD:        true,
			Strength:      StrengthAdvanced,
			SupportedVers: []uint16{tls.VersionTLS13},
		},
		{
			ID:            tls.TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256,
			Name:          "TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256",
			KeySize:       128,
			IsAEAD:        true,
			Strength:      StrengthModern,
			SupportedVers: []uint16{tls.VersionTLS12},
		},
		{
			ID:            tls.TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384,
			Name:          "TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384",
			KeySize:       256,
			IsAEAD:        true,
			Strength:      StrengthModern,
			SupportedVers: []uint16{tls.VersionTLS12},
		},
		{
			ID:            tls.TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA256,
			Name:          "TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA256",
			KeySize:       128,
			IsAEAD:        false,
			Strength:      StrengthLegacy,
			SupportedVers: []uint16{tls.VersionTLS12},
		},
		{
			ID:            tls.TLS_RSA_WITH_AES_128_CBC_SHA,
			Name:          "TLS_RSA_WITH_AES_128_CBC_SHA",
			KeySize:       128,
			IsAEAD:        false,
			Strength:      StrengthLegacy,
			SupportedVers: []uint16{tls.VersionTLS10, tls.VersionTLS11, tls.VersionTLS12},
		},
		{
			ID:            0x000a, // TLS_RSA_WITH_3DES_EDE_CBC_SHA
			Name:          "TLS_RSA_WITH_3DES_EDE_CBC_SHA",
			KeySize:       168,
			IsAEAD:        false,
			Strength:      StrengthWeak,
			SupportedVers: []uint16{tls.VersionTLS10, tls.VersionTLS11, tls.VersionTLS12},
		},
		{
			ID:            0x0005, // TLS_RSA_WITH_RC4_128_SHA
			Name:          "TLS_RSA_WITH_RC4_128_SHA",
			KeySize:       128,
			IsAEAD:        false,
			Strength:      StrengthWeak,
			SupportedVers: []uint16{tls.VersionTLS10, tls.VersionTLS11},
		},
	}
}

// lookupSuite retrieves a suite from the cache, falling back to a linear
// scan of knownSuites. Results are cached for faster repeated lookups.
// BUG(5): suiteCache is read/written without holding r.mu.
func (r *SuiteRegistry) lookupSuite(id uint16) *CipherSuite {
	if cached, ok := r.suiteCache[id]; ok {
		return cached
	}

	for _, s := range r.knownSuites {
		if s.ID == id {
			r.suiteCache[id] = s
			return s
		}
	}
	return nil
}

// NegotiateSuite picks the best mutually-supported cipher suite.
// It iterates server-side preferences and returns the first match found
// in the client's offered list.
//
// BUG(1): When no suite matches, selectedSuite remains nil and the
// function dereferences it to build the return value.
func (r *SuiteRegistry) NegotiateSuite(clientSuites []uint16) (string, error) {
	if len(clientSuites) == 0 {
		return "", errors.New("tlscipher: client offered no cipher suites")
	}

	clientSet := make(map[uint16]bool, len(clientSuites))
	for _, id := range clientSuites {
		clientSet[id] = true
	}

	var selectedSuite *CipherSuite

	ordered := r.SortByPreference(r.FilterWeakSuites(r.knownSuites))
	for _, suite := range ordered {
		if clientSet[suite.ID] {
			selectedSuite = suite
			break
		}
	}

	// BUG(1): nil dereference when no suite matched
	return selectedSuite.Name, nil
}

// FilterWeakSuites removes cipher suites that do not meet the minimum
// security threshold. Currently only checks key size against a fixed
// floor of 128 bits.
//
// BUG(3): Only filters by key size. Suites using RC4 or 3DES are
// considered weak regardless of key size, but this function does not
// check the cipher algorithm name.
func (r *SuiteRegistry) FilterWeakSuites(suites []*CipherSuite) []*CipherSuite {
	const minKeyBits = 128

	result := make([]*CipherSuite, 0, len(suites))
	for _, s := range suites {
		if s.KeySize >= minKeyBits {
			result = append(result, s)
		}
	}
	return result
}

// SortByPreference returns a copy of the slice ordered by server
// preference. AEAD suites should be preferred over non-AEAD, and
// higher strength suites should come first within each group.
//
// BUG(4): The AEAD comparison is inverted — non-AEAD suites end up
// ranked above AEAD suites.
func (r *SuiteRegistry) SortByPreference(suites []*CipherSuite) []*CipherSuite {
	sorted := make([]*CipherSuite, len(suites))
	copy(sorted, suites)

	sort.SliceStable(sorted, func(i, j int) bool {
		si, sj := sorted[i], sorted[j]

		// BUG(4): operator is flipped; should be si.IsAEAD && !sj.IsAEAD
		if si.IsAEAD != sj.IsAEAD {
			return !si.IsAEAD && sj.IsAEAD
		}

		// Higher strength first
		if si.Strength != sj.Strength {
			return si.Strength > sj.Strength
		}

		// Larger key size breaks ties
		return si.KeySize > sj.KeySize
	})

	return sorted
}

// ConcurrentLookup demonstrates a batch lookup of suite IDs from
// multiple goroutines. Each goroutine writes to the shared suiteCache
// without synchronization.
// BUG(5): data race — multiple goroutines call lookupSuite which reads
// and writes r.suiteCache without locking.
func (r *SuiteRegistry) ConcurrentLookup(ids []uint16) ([]*CipherSuite, error) {
	results := make([]*CipherSuite, len(ids))
	var wg sync.WaitGroup
	errs := make([]error, len(ids))

	for i, id := range ids {
		wg.Add(1)
		go func(idx int, suiteID uint16) {
			defer wg.Done()
			suite := r.lookupSuite(suiteID)
			if suite == nil {
				errs[idx] = fmt.Errorf("tlscipher: unknown suite 0x%04x", suiteID)
				return
			}
			results[idx] = suite
		}(i, id)
	}
	wg.Wait()

	for _, err := range errs {
		if err != nil {
			return results, err
		}
	}
	return results, nil
}

// SuiteNames returns the display names for a list of suite IDs.
func (r *SuiteRegistry) SuiteNames(ids []uint16) []string {
	names := make([]string, 0, len(ids))
	for _, id := range ids {
		if s := r.lookupSuite(id); s != nil {
			names = append(names, s.Name)
		}
	}
	return names
}

// HasAESNI reports whether the current platform likely supports
// hardware AES acceleration. This is a rough heuristic based on
// runtime.GOARCH.
func HasAESNI() bool {
	return runtime.GOARCH == "amd64"
}

// FormatSuite returns a human-readable summary string for a suite.
func FormatSuite(s *CipherSuite) string {
	aead := "non-AEAD"
	if s.IsAEAD {
		aead = "AEAD"
	}
	vers := make([]string, len(s.SupportedVers))
	for i, v := range s.SupportedVers {
		switch v {
		case tls.VersionTLS10:
			vers[i] = "TLS1.0"
		case tls.VersionTLS11:
			vers[i] = "TLS1.1"
		case tls.VersionTLS12:
			vers[i] = "TLS1.2"
		case tls.VersionTLS13:
			vers[i] = "TLS1.3"
		default:
			vers[i] = fmt.Sprintf("0x%04x", v)
		}
	}
	return fmt.Sprintf("%s [%d-bit %s] (%s)", s.Name, s.KeySize, aead, strings.Join(vers, ", "))
}
