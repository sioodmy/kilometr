#include <stdint.h>
#include <stddef.h>

uint8_t *kilometr_ios_call(int32_t op, int32_t a, int32_t b,
                         const uint8_t *input, size_t len, size_t *out_len);
void kilometr_ios_free(uint8_t *ptr, size_t len);
