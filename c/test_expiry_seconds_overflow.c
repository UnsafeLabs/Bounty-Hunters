#include <assert.h>
#include <stdint.h>

int main(void) {
    int day_diff = 25000;
    int sec_diff = 0;
    int64_t remaining_seconds = (int64_t)day_diff * 86400 + sec_diff;

    assert(remaining_seconds == 2160000000LL);
    assert(remaining_seconds >= (int64_t)86400 * 30);
    return 0;
}