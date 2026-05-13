// Spanish comment translation of go/tls_cipher.go. Code is unchanged; comments are localized.
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

// CipherStrength representa el nivel de seguridad de un conjunto de cifrado.
type CipherStrength int

const (
	StrengthWeak     CipherStrength = iota // Known-broken or deprecated
	StrengthLegacy                         // Acceptable for backward compat only
	StrengthModern                         // Recommended for general use
	StrengthAdvanced                       // Highest security, may cost performance
)

// CipherSuite contiene metadatos sobre un único conjunto de cifrado TLS.
type CipherSuite struct {
	ID            uint16
	Name          string
	KeySize       int
	IsAEAD        bool
	Strength      CipherStrength
	SupportedVers []uint16 // TLS versions where this suite is valid
}

// El negociador selecciona y ordena conjuntos de cifrado para un protocolo de enlace TLS.
type Negotiator interface {
	NegotiateSuite(clientSuites []uint16) (string, error)
	FilterWeakSuites(suites []*CipherSuite) []*CipherSuite
	SortByPreference(suites []*CipherSuite) []*CipherSuite
}

// SuiteRegistry es la implementación predeterminada de Negotiator. mantiene
// un registro de suites conocidas y una caché de búsqueda segura para la concurrencia.
type SuiteRegistry struct {
	knownSuites []*CipherSuite
	minStrength CipherStrength
	preferredID uint16
	suiteCache  map[uint16]*CipherSuite // BUG(5): unprotected shared cache
	mu          sync.Mutex              // guards knownSuites only
}

// NewSuiteRegistry crea un registro precargado con conjuntos de cifrado comunes.
func NewSuiteRegistry(minStrength CipherStrength) *SuiteRegistry {
	reg := &SuiteRegistry{
		minStrength: minStrength,
		suiteCache:  make(map[uint16]*CipherSuite),
	}
	reg.loadDefaults()
	return reg
}

// loadDefaults llena el registro con un conjunto representativo de suites.
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

// lookupSuite recupera una suite del caché y vuelve a un formato lineal
// escaneo de suites conocidas. Los resultados se almacenan en caché para realizar búsquedas repetidas más rápidas.
// ERROR (5): suiteCache se lee/escribe sin mantener presionado r.mu.
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

// NegotiateSuite elige el mejor conjunto de cifrado con soporte mutuo.
// Itera las preferencias del lado del servidor y devuelve la primera coincidencia encontrada.
// en la lista de ofertas del cliente.
//
// ERROR (1): Cuando ninguna suite coincide, la Suite seleccionada permanece nula y el
// La función lo desreferencia para generar el valor de retorno.
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

	// ERROR (1): desreferencia nula cuando ninguna suite coincide
	return selectedSuite.Name, nil
}

// FilterWeakSuites elimina los conjuntos de cifrado que no cumplen con el mínimo
// umbral de seguridad. Actualmente solo verifica el tamaño de la clave con un valor fijo
// piso de 128 bits.
//
// ERROR (3): solo filtra por tamaño de clave. Las suites que utilizan RC4 o 3DES son
// se considera débil independientemente del tamaño de la clave, pero esta función no
// verifique el nombre del algoritmo de cifrado.
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

// SortByPreference devuelve una copia del segmento ordenado por servidor
// preferencia. Se deben preferir las suites AEAD a las que no son AEAD, y
// Las suites de mayor fuerza deben ocupar el primer lugar dentro de cada grupo.
//
// ERROR (4): La comparación de AEAD está invertida: las suites que no son de AEAD terminan
// clasificado por encima de las suites AEAD.
func (r *SuiteRegistry) SortByPreference(suites []*CipherSuite) []*CipherSuite {
	sorted := make([]*CipherSuite, len(suites))
	copy(sorted, suites)

	sort.SliceStable(sorted, func(i, j int) bool {
		si, sj := sorted[i], sorted[j]

		// ERROR (4): el operador está invertido; debería ser si.IsAEAD && !sj.IsAEAD
		if si.IsAEAD != sj.IsAEAD {
			return !si.IsAEAD && sj.IsAEAD
		}

		// Mayor fuerza primero
		if si.Strength != sj.Strength {
			return si.Strength > sj.Strength
		}

		// Un tamaño de clave más grande rompe lazos
		return si.KeySize > sj.KeySize
	})

	return sorted
}

// ConcurrentLookup demuestra una búsqueda por lotes de ID de suite de
// múltiples gorutinas. Cada goroutine escribe en el suiteCache compartido
// sin sincronización.
// ERROR (5): carrera de datos: múltiples gorutinas llaman a lookupSuite que lee
// y escribe r.suiteCache sin bloquear.
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

// SuiteNames devuelve los nombres para mostrar de una lista de ID de suite.
func (r *SuiteRegistry) SuiteNames(ids []uint16) []string {
	names := make([]string, 0, len(ids))
	for _, id := range ids {
		if s := r.lookupSuite(id); s != nil {
			names = append(names, s.Name)
		}
	}
	return names
}

// HasAESNI informa si es probable que la plataforma actual admita
// Aceleración AES por hardware. Esta es una heurística aproximada basada en
// tiempo de ejecución.GOARCH.
func HasAESNI() bool {
	return runtime.GOARCH == "amd64"
}

// FormatSuite devuelve una cadena de resumen legible por humanos para una suite.
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
