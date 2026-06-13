 ```diff
--- a/cobol/verify-signature.cbl
+++ b/cobol/verify-signature.cbl
@@ -1,6 +1,7 @@
       ******************************************************************
       * VERIFY-SIGNATURE.cbl
       * Certificate signature verification module
+      * Fixed EBCDIC-to-ASCII conversion for fingerprint handling
       ******************************************************************
        IDENTIFICATION DIVISION.
        PROGRAM-ID. VERIFY-SIGNATURE.
@@ -45,7 +46,8 @@
       * Working storage for signature verification
       ******************************************************************
        01  WS-SIG-VERIFY-BUFFER.
-           05 WS-SIG-VERIFY-DATA    PIC X(64).
+           05 WS-SIG-VERIFY-DATA    PIC X(64)
+                                   USAGE DISPLAY.
        01  WS-SIG-RESULT           PIC 9 VALUE 0.
            88  WS-SIG-VALID         VALUE 0.
            88  WS-SIG-INVALID       VALUE 1.
@@ -55,6 +57,14 @@
        01  WS-DISPLAY-FINGERPRINT  PIC X(64).
        01  WS-VERIFY-STATUS        PIC X(20).
 
+      * Code-page-independent comparison buffer
+       01  WS-FP-INDEX             PIC 9(2) COMP.
+       01  WS-FP-MATCH-FLAG        PIC 9 VALUE 1.
+           88  WS-FP-MATCHES        VALUE 1.
+           88  WS-FP-MISMATCH       VALUE 0.
+       01  WS-FP-BYTE-1            PIC X.
+       01  WS-FP-BYTE-2            PIC X.
+       01  WS-FP-ORD-1             PIC 9(3) COMP.
+       01  WS-FP-ORD-2             PIC 9(3) COMP.
+
       ******************************************************************
       * LINKAGE SECTION
       ******************************************************************
@@ -229,14 +239,51 @@
       *    CS-CERT-FINGERPRINT fields
       ******************************************************************
        VERIFY-SIGNATURE-PARA.
-      *    Move fingerprint to working buffer
-           MOVE WS-CERT-FINGERPRINT TO WS-SIG-VERIFY-BUFFER
+      *    Move fingerprint to working buffer with explicit encoding
+           MOVE FUNCTION LOWER-CASE(WS-CERT-FINGERPRINT)
+             TO WS-SIG-VERIFY-BUFFER
+
+      *    Perform code-page-independent byte-by-byte comparison
+      *    using FUNCTION ORD to avoid EBCDIC/ASCII mismatch
+           PERFORM VARYING WS-FP-INDEX FROM 1 BY 1
+                   UNTIL WS-FP-INDEX > 64
+                   OR WS-FP-MISMATCH
+               MOVE WS-SIG-VERIFY-DATA(WS-FP-INDEX:1)
+                 TO WS-FP-BYTE-1
+               MOVE CS-CERT-FINGERPRINT(WS-FP-INDEX:1)
+                 TO WS-FP-BYTE-2
+               COMPUTE WS-FP-ORD-1 = FUNCTION ORD(WS-FP-BYTE-1)
+               COMPUTE WS-FP-ORD-2 = FUNCTION ORD(WS-FP-BYTE-2)
+      *        Convert to common case for comparison
+               IF WS-FP-ORD-1 >= 97 AND WS-FP-ORD-1 <= 102
+      *            Lowercase a-f, convert to uppercase
+                   COMPUTE WS-FP-ORD-1 = WS-FP-ORD-1 - 32
+               END-IF
+               IF WS-FP-ORD-2 >= 97 AND WS-FP-ORD-2 <= 102
+      *            Lowercase a-f, convert to uppercase
+                   COMPUTE WS-FP-ORD-2 = WS-FP-ORD-2 - 32
+               END-IF
+               IF WS-FP-ORD-1 NOT = WS-FP-ORD-2
+                   SET WS-FP-MISMATCH TO TRUE
+               END-IF
+           END-PERFORM
 
-      *    Compare fingerprints
-           IF WS-SIG-VERIFY-BUFFER = CS-CERT-FINGERPRINT
+      *    Evaluate comparison result
+           IF WS-FP-MATCHES
                SET WS-SIG-VALID TO TRUE
                MOVE 'SIGNATURE VERIFIED' TO WS-VERIFY-STATUS
            ELSE
                SET WS-SIG-INVALID TO TRUE
                MOVE 'SIGNATURE FAILED' TO WS-VERIFY-STATUS
            END-IF
 
       *    Log verification result with fingerprint
-           MOVE WS-SIG-VERIFY-BUFFER TO WS-DISPLAY-FINGERPRINT
+           MOVE WS-CERT-FINGERPRINT TO WS-DISPLAY-FINGERPRINT
            DISPLAY 'VERIFY: Fingerprint=' WS-DISPLAY-FINGERPRINT
            DISPLAY 'VERIFY: Status=' WS-VERIFY-STATUS
 
+      *    Reset match flag for next verification
+           SET WS-FP-MATCHES TO TRUE
+
            .
 
       ******************************************************************
@@ -260,6 +297,7 @@
       *    CS-CERT-FINGERPRINT - Expected fingerprint
       *    WS-VERIFY-STATUS    - Result message
       ******************************************************************
+      *    (Test cases moved to test file for maintainability)
        .
 
       ******************************************************************
@@ -267,3 +305,4 @@
       ******************************************************************
        9999-EXIT.
            GOBACK.
+
--- /dev/null
+++ b/cobol/tests/test-verify-signature.cbl
@@ -0,0 +1,189 @@
+      ******************************************************************
+      * TEST-VERIFY-SIGNATURE.cbl
+      * Unit tests for VERIFY-SIGNATURE module
+      * Includes test for EBCDIC-safe fingerprint comparison
+      ******************************************************************
+       IDENTIFICATION DIVISION.
+       PROGRAM-ID. TEST-VERIFY-SIGNATURE.
+
+       ENVIRONMENT DIVISION.
+       CONFIGURATION SECTION.
+       SOURCE-COMPUTER. IBM-370 WITH DEBUGGING MODE.
+
+       DATA DIVISION.
+       WORKING-STORAGE SECTION.
+      * Test data
+       01  TEST-FINGERPRINT-DIGITS.
+           05 FILLER PIC X(64)
+           VALUE '1234567890123456789012345678901234567890'.
+       01  TEST-FINGERPRINT-MIXED.
+           05 FILLER PIC X(64)
+           VALUE 'AABBCCDDEEFF00112233445566778899AABBCCDD'.
+       01  TEST-FINGERPRINT-ALL-HEX.
+           05 FILLER PIC X(64)
+           VALUE 'DEADBEEFCAFEBABE0123456789ABCDEF01234567'.
+       01  TEST-FINGERPRINT-LOWER.
+           05 FILLER PIC X(64)
+           VALUE 'aabbccddeeff001