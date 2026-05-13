#include <assert.h>
#include <stddef.h>
#include <string.h>

static int crypto_memcmp_calls = 0;

int test_crypto_memcmp(const void *a, const void *b, size_t len);

#define CRYPTO_memcmp test_crypto_memcmp
#include "tls_cert_validator.c"
#undef CRYPTO_memcmp

int test_crypto_memcmp(const void *a, const void *b, size_t len)
{
    crypto_memcmp_calls++;
    return memcmp(a, b, len);
}

int main(void)
{
    unsigned char expected[FINGERPRINT_LEN];
    unsigned char matching[FINGERPRINT_LEN];
    unsigned char mismatched[FINGERPRINT_LEN];

    memset(expected, 0x7a, sizeof(expected));
    memcpy(matching, expected, sizeof(matching));
    memcpy(mismatched, expected, sizeof(mismatched));
    mismatched[FINGERPRINT_LEN - 1] ^= 0xff;

    crypto_memcmp_calls = 0;
    assert(match_fingerprint(expected, matching));
    assert(crypto_memcmp_calls == 1);

    crypto_memcmp_calls = 0;
    assert(!match_fingerprint(expected, mismatched));
    assert(crypto_memcmp_calls == 1);

    return 0;
}
