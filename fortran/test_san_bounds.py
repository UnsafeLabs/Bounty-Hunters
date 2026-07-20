"""PARSSAN bounds model (issue #563)."""
E_SANLONG = 901

def parssan(der):
    tmp = ["\0"] * 256
    iptr = 0
    for ch in der:
        if iptr >= 256:
            return E_SANLONG, tmp
        tmp[iptr] = ch
        iptr += 1
    return 0, tmp

assert parssan("a" * 128)[0] == 0
assert parssan("a" * 256)[0] == 0
assert parssan("a" * 257)[0] == E_SANLONG

def santyp(tag):
    return tag - 127 if 128 <= tag <= 135 else -1

assert santyp(0x87) == 8
assert santyp(0x99) == -1
print("Fortran SAN bounds tests: ALL PASSED")
