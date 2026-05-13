#include <stdio.h>
#include <string.h>

#include "tls_cert_validator.c"

int main(void)
{
    unsigned char expected[FINGERPRINT_LEN];
    unsigned char same[FINGERPRINT_LEN];
    unsigned char different[FINGERPRINT_LEN];

    memset(expected, 0x41, sizeof(expected));
    memcpy(same, expected, sizeof(same));
    memcpy(different, expected, sizeof(different));
    different[FINGERPRINT_LEN - 1] ^= 0xff;

    if (match_fingerprint(expected, same) != 0) {
        fprintf(stderr, "matching fingerprints must return 0\n");
        return 1;
    }

    if (match_fingerprint(expected, different) == 0) {
        fprintf(stderr, "different fingerprints must return nonzero\n");
        return 1;
    }

    return 0;
}
