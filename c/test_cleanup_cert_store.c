#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "tls_cert_validator.c"

static cert_entry_t *make_entry(const char *subject, const char *issuer)
{
    cert_entry_t *entry = calloc(1, sizeof(cert_entry_t));
    assert(entry != NULL);
    entry->subject = strdup(subject);
    entry->issuer = strdup(issuer);
    assert(entry->subject != NULL);
    assert(entry->issuer != NULL);
    return entry;
}

int main(void)
{
    cert_store_t store = { 0 };
    cert_entry_t *first = make_entry("subject-1", "issuer-1");
    cert_entry_t *second = make_entry("subject-2", "issuer-2");
    cert_entry_t *third = make_entry("subject-3", "issuer-3");

    first->next = second;
    second->next = third;
    store.head = first;
    store.count = 3;
    g_log_level = LOG_LEVEL_DEBUG;

    cleanup_cert_store(&store);

    assert(store.head == NULL);
    assert(store.count == 0);
    return 0;
}
