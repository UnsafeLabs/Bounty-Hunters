#include <assert.h>
#include <stdarg.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static char captured_log[1024];
static size_t captured_log_len = 0;
static char *tracked_subject = NULL;
static char *tracked_issuer = NULL;

static int append_log(const char *fmt, va_list ap)
{
    size_t remaining = 0;
    int written = 0;

    if (captured_log_len >= sizeof(captured_log))
        return 0;

    remaining = sizeof(captured_log) - captured_log_len;
    written = vsnprintf(captured_log + captured_log_len, remaining, fmt, ap);
    if (written <= 0)
        return written;

    if ((size_t)written >= remaining)
        captured_log_len = sizeof(captured_log) - 1;
    else
        captured_log_len += (size_t)written;
    return written;
}

static int test_fprintf(FILE *stream, const char *fmt, ...)
{
    va_list ap;
    int written;
    (void)stream;

    va_start(ap, fmt);
    written = append_log(fmt, ap);
    va_end(ap);
    return written;
}

static int test_vfprintf(FILE *stream, const char *fmt, va_list ap)
{
    (void)stream;
    return append_log(fmt, ap);
}

static void tracked_free(void *ptr)
{
    if (ptr == tracked_subject || ptr == tracked_issuer)
        memset(ptr, '#', strlen((char *)ptr));
}

#define fprintf test_fprintf
#define vfprintf test_vfprintf
#define free tracked_free
#include "tls_cert_validator.c"
#undef fprintf
#undef vfprintf
#undef free

static void test_cleanup_logs_issuer_before_free(void)
{
    cert_store_t store = {0};
    cert_entry_t *entry = calloc(1, sizeof(*entry));

    assert(entry != NULL);
    entry->subject = strdup("subject");
    entry->issuer = strdup("issuer");
    assert(entry->subject != NULL);
    assert(entry->issuer != NULL);

    tracked_subject = entry->subject;
    tracked_issuer = entry->issuer;
    store.head = entry;
    store.count = 1;

    captured_log[0] = '\0';
    captured_log_len = 0;
    g_log_level = LOG_LEVEL_DEBUG;

    cleanup_cert_store(&store);

    assert(strstr(captured_log, "freed cert store entry: issuer") != NULL);
    assert(strstr(captured_log, "freed cert store entry: ######") == NULL);
    assert(store.head == NULL);
    assert(store.count == 0);
}

int main(void)
{
    test_cleanup_logs_issuer_before_free();
    return 0;
}
