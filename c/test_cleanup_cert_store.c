#include <assert.h>
#include <stdlib.h>
#include <string.h>

#include "tls_cert_validator.c"

static cert_entry_t *entry_with_issuer(const char *issuer) {
    cert_entry_t *entry = calloc(1, sizeof(*entry));
    assert(entry != NULL);
    entry->subject = strdup("subject");
    entry->issuer = strdup(issuer);
    assert(entry->subject != NULL);
    assert(entry->issuer != NULL);
    return entry;
}

int main(void) {
    cert_store_t store = {0};
    g_log_level = LOG_LEVEL_DEBUG;

    store.head = entry_with_issuer("issuer-1");
    store.head->next = entry_with_issuer("issuer-2");
    store.count = 2;

    cleanup_cert_store(&store);

    assert(store.head == NULL);
    assert(store.count == 0);
    return 0;
}