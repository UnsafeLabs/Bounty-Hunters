#include <assert.h>
#include <string.h>

#include "tls_cert_validator.c"

int main(void) {
    unsigned char a[FINGERPRINT_LEN] = {0};
    unsigned char b[FINGERPRINT_LEN] = {0};

    assert(match_fingerprint(a, b));
    b[FINGERPRINT_LEN - 1] = 1;
    assert(!match_fingerprint(a, b));
    return 0;
}