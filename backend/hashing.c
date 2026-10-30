#include <stddef.h>
#include "hashing.h"

unsigned long long hashBookingKey(const char *text)
{
unsigned long long hash = 5381;


if (text == NULL) {
    return hash;
}

while (*text != '\0') {
    hash = ((hash << 5) + hash) + (unsigned char)*text;
    text++;
}

return hash;


}


