#include <assert.h>
#include <string.h>

#include "tls_cert_validator.c"

int main(void)
{
    unsigned char expected[FINGERPRINT_LEN];
    unsigned char matching[FINGERPRINT_LEN];
    unsigned char mismatched[FINGERPRINT_LEN];

    memset(expected, 0x7a, sizeof(expected));
    memcpy(matching, expected, sizeof(matching));
    memcpy(mismatched, expected, sizeof(mismatched));
    mismatched[FINGERPRINT_LEN - 1] ^= 0xff;

    assert(match_fingerprint(expected, matching));
    assert(!match_fingerprint(expected, mismatched));
    return 0;
}
