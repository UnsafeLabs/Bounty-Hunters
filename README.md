# Bounty-Hunters

## Fixing EQUIVALENCE Overlap and Related Issues in TLSMOD.f

The issue described involves several critical bugs in the Fortran 77 code of the `TLSMOD.f` module, which can lead to data corruption and incorrect behavior when parsing X.509 SubjectAltName extensions. These bugs are related to the use of `EQUIVALENCE`, mixed-mode comparisons, and computed `GOTO` statements, all of which can cause the `CERTBUF` to overwrite `SIGBLOCK` and lead to incorrect signature verification.

### 1. Removing `EQUIVALENCE` and Using Independent Variables

The `EQUIVALENCE` statement at line 47 maps the second half of `CERTBUF` to `TMPBUF`, which can cause `CERTBUF(257:)` to overwrite `SIGBLOCK` when the SubjectAltName exceeds 128 bytes. To fix this, we should remove the `EQUIVALENCE` statement and declare `TMPBUF` as an independent `CHARACTER*256` variable in the `COMMON` block, ensuring it is placed after `SIGBLOCK` to avoid overlap.

```fortran
COMMON /TLSBLK/ CERTBUF(256), SIGBLOCK(128), TMPBUF(256)
```

This ensures that `TMPBUF` is allocated separately and does not interfere with `SIGBLOCK`.

### 2. Bounds Checking in `PARSSAN`

The `PARSSAN` subroutine writes the SubjectAltName into `TMPBUF` using a loop. To prevent overflow, we should add a bounds check to ensure `IPTR` does not exceed 128. If it does, the loop should jump to an error label and set `IERR = E_SANLONG`.

```fortran
IF (IPTR .GT. 128) GO TO 900
```

### 3. Normalizing Character Comparisons

The mixed-mode comparison at line 183 between `NXTSAN` (implicit integer) and `NXTDER` (implicit character) can fail due to EBCDIC vs ASCII conversion differences. We should replace this with an explicit comparison using `ICHAR` and a normalization function `CPCHAR` that uses a 256-byte translation table to convert between EBCDIC and ASCII.

```fortran
IF (ICHAR(CPCHAR(NXTSAN)) .EQ. ICHAR(CPCHAR(NXTDER))) THEN
```

### 4. Replacing Computed `GOTO` with `IF-ELSEIF` Chain

The computed `GOTO` at line 210 is unreliable and can lead to undefined behavior if `ITYP` exceeds the range of labels. We should replace this with an `IF-ELSEIF` chain or `SELECT CASE` (Fortran 90) that covers all valid tag values from 0x80 to 0x87, including the iPAddress type (0x87).

```fortran
IF (ITYP .EQ. 0x80) THEN
   ! Handle tag 0x80
ELSE IF (ITYP .EQ. 0x81) THEN
   ! Handle tag 0x81
   ...
ELSE IF (ITYP .EQ. 0x87) THEN
   ! Handle iPAddress SAN type
ELSE
   ! Handle invalid tag
END IF
```

### 5. Adding a Test Subroutine

Finally, we should add a test subroutine `TSTSANP` that exercises various scenarios, including SAN lengths of 128, 129, and 256 bytes, as well as the iPAddress type and mixed ASCII/EBCDIC comparisons.

```fortran
SUBROUTINE TSTSANP
   ! Test cases for SAN parsing
END SUBROUTINE TSTSANP
```

These changes ensure that the code is robust, portable, and adheres to modern Fortran practices.
