package tlscipher

import "testing"

func TestNegotiateSuiteReturnsErrorWhenNoMatch(t *testing.T) {
	reg := NewSuiteRegistry(StrengthWeak)
	if _, err := reg.NegotiateSuite([]uint16{0xFFFF}); err == nil {
		t.Fatal("expected error when no cipher suite matches")
	}
}
