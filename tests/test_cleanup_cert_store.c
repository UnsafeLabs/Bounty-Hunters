#include <assert.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

/* Keep this unit test focused on cleanup_cert_store() string lifetime ordering. */
#define X509_free test_X509_free
#include "../c/tls_cert_validator.c"
#undef X509_free

void test_X509_free(X509 *cert)
{
    (void)cert;
}

static cert_entry_t *make_entry(const char *subject, const char *issuer)
{
    cert_entry_t *entry = calloc(1, sizeof(*entry));
    assert(entry);
    entry->subject = strdup(subject);
    entry->issuer = strdup(issuer);
    assert(entry->subject);
    assert(entry->issuer);
    return entry;
}

int main(void)
{
    cert_store_t store = { 0 };
    char log_template[] = "/tmp/cert-cleanup-log.XXXXXX";
    char log_output[2048] = { 0 };
    int log_fd = mkstemp(log_template);
    int saved_stderr = dup(STDERR_FILENO);
    ssize_t bytes_read;

    assert(log_fd >= 0);
    assert(saved_stderr >= 0);

    store.head = make_entry("subject-one", "issuer-one");
    store.head->next = make_entry("subject-two", "issuer-two");
    store.head->next->next = make_entry("subject-three", "issuer-three");
    store.count = 3;
    store.max_depth = MAX_CHAIN_DEPTH;

    assert(dup2(log_fd, STDERR_FILENO) >= 0);
    g_log_level = LOG_LEVEL_DEBUG;
    cleanup_cert_store(&store);
    fflush(stderr);
    assert(dup2(saved_stderr, STDERR_FILENO) >= 0);
    close(saved_stderr);

    assert(store.head == NULL);
    assert(store.count == 0);

    assert(lseek(log_fd, 0, SEEK_SET) == 0);
    bytes_read = read(log_fd, log_output, sizeof(log_output) - 1);
    assert(bytes_read > 0);
    close(log_fd);
    unlink(log_template);

    assert(strstr(log_output, "issuer-one"));
    assert(strstr(log_output, "issuer-two"));
    assert(strstr(log_output, "issuer-three"));

    return 0;
}
