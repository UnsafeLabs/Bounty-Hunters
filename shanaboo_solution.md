 ```diff
--- a/cobol/verify-signature.cob
+++ b/cobol/verify-signature.cob
@@ -1,0 +1,150 @@
+      *================================================================*
+      * VERIFY-SIGNATURE - Certificate signature verification module
+      *================================================================*
+       IDENTIFICATION DIVISION.
+       PROGRAM-ID. VERIFY-SIGNATURE.
+       ENVIRONMENT DIVISION.
+       CONFIGURATION SECTION.
+       SPECIAL-NAMES.
+           CLASS HEX-CHAR IS "0123456789ABCDEF".
+       DATA DIVISION.
+       WORKING-STORAGE SECTION.
+      *----------------------------------------------------------------*
+      * Certificate fingerprint fields
+      *----------------------------------------------------------------*
+       01  WS-CERT-FINGERPRINT.
+           05  WS-CERT-FINGERPRINT-BYTE  PIC X(64) USAGE DISPLAY.
+       01  CS-CERT-FINGERPRINT.
+           05  CS-CERT-FINGERPRINT-BYTE  PIC X(64) USAGE DISPLAY.
+      *----------------------------------------------------------------*
+      * Verification buffer - must match encoding of CS-CERT-FINGERPRINT
+      * to prevent EBCDIC-to-ASCII conversion corruption on z/OS
+      *----------------------------------------------------------------*
+       01  WS-SIG-VERIFY-BUFFER.
+           05  WS-SIG-VERIFY-BYTE        PIC X(64) USAGE DISPLAY.
+      *----------------------------------------------------------------*
+      * Temporary variables for code-page-independent comparison
+      *----------------------------------------------------------------*
+       01  WS-IDX                        PIC 9(4) COMP.
+       01  WS-LENGTH                     PIC 9(4) COMP VALUE 64.
+       01  WS-MATCH-FOUND                PIC X VALUE 'N'.
+           88  MATCH-YES                 VALUE 'Y'.
+           88  MATCH-NO                  VALUE 'N'.
+       01  WS-ORD1                       PIC 9(4) COMP.
+       01  WS-ORD2                       PIC 9(4) COMP.
+       01  WS-TEST-FINGERPRINT.
+           05  WS-TEST-BYTE              PIC X(64) USAGE DISPLAY.
+       01  WS-HEX-STR                    PIC X(128).
+       01  WS-DISPLAY-IDX                PIC 9(4) COMP.
+      *----------------------------------------------------------------*
+      * Test data for A-F hex character verification
+      *----------------------------------------------------------------*
+       01  WS-TEST-CASES.
+           05  WS-TEST-DIGITS-ONLY.
+               10  FILLER                PIC X(64) VALUE
+                   "1234567890123456789012345678901234567890" &
+                   "1234567890123456789012345678901234".
+           05  WS-TEST-AF-HEX.
+               10  FILLER                PIC X(64) VALUE
+                   "AABBCCDDEEFF00112233445566778899AABBCCDD" &
+                   "EEFF00112233445566778899AABBCCDDEEFF00".
+           05  WS-TEST-MIXED-HEX.
+               10  FILLER                PIC X(64) VALUE
+                   "DEADBEEFCAFE1234567890ABCDEF1234567890AB" &
+                   "CDEF1234567890ABCDEF1234567890ABCDEF12".
+      *----------------------------------------------------------------*
+      * Result and logging fields
+      *----------------------------------------------------------------*
+       01  WS-RESULT-MSG                 PIC X(80).
+       01  WS-LOG-FINGERPRINT            PIC X(64).
+
+       PROCEDURE DIVISION.
+      *----------------------------------------------------------------*
+      * Main entry point
+      *----------------------------------------------------------------*
+       MAIN-LOGIC.
+           PERFORM VERIFY-SIGNATURE
+           STOP RUN.
+
+      *----------------------------------------------------------------*
+      * VERIFY-SIGNATURE paragraph
+      * Verifies certificate fingerprint against stored certificate
+      *----------------------------------------------------------------*
+       VERIFY-SIGNATURE.
+      *    Move fingerprint to buffer with matching encoding
+           MOVE WS-CERT-FINGERPRINT TO WS-SIG-VERIFY-BUFFER
+      *
+      *    Perform code-page-independent comparison using FUNCTION ORD
+      *    on each byte to handle EBCDIC/ASCII differences for hex A-F
+           PERFORM CODEPAGE-INDEPENDENT-COMPARE
+      *
+      *    Log the fingerprint with correct hex values
+           PERFORM LOG-FINGERPRINT
+           .
+
+      *----------------------------------------------------------------*
+      * CODEPAGE-INDEPENDENT-COMPARE
+      * Compares fingerprints byte-by-byte using FUNCTION ORD
+      * to avoid EBCDIC-to-ASCII conversion issues for hex chars A-F
+      *----------------------------------------------------------------*
+       CODEPAGE-INDEPENDENT-COMPARE.
+           SET MATCH-NO TO TRUE
+           PERFORM VARYING WS-IDX FROM 1 BY 1 UNTIL WS-IDX > WS-LENGTH
+               COMPUTE WS-ORD1 = FUNCTION ORD(
+                   WS-SIG-VERIFY-BYTE(WS-IDX:1))
+               COMPUTE WS-ORD2 = FUNCTION ORD(
+                   CS-CERT-FINGERPRINT-BYTE(WS-IDX:1))
+               IF WS-ORD1 NOT EQUAL WS-ORD2
+                   GO TO CODEPAGE-COMPARE-EXIT
+               END-IF
+           END-PERFORM
+           SET MATCH-YES TO TRUE
+           .
+       CODEPAGE-COMPARE-EXIT.
+           EXIT.
+
+      *----------------------------------------------------------------*
+      * LOG-FINGERPRINT
+      * Displays fingerprint with correct hex values
+      *----------------------------------------------------------------*
+       LOG-FINGERPRINT.
+           MOVE WS-SIG-VERIFY-BUFFER TO WS-LOG-FINGERPRINT
+           DISPLAY "Certificate fingerprint: " WS-LOG-FINGERPRINT
+           IF MATCH-YES
+               DISPLAY "Fingerprint verification: PASSED"
+           ELSE
+               DISPLAY "Fingerprint verification: FAILED"
+           END-IF
+           .
+
+      *----------------------------------------------------------------*
+      * TEST-VERIFY-SIGNATURE
+      * Test entry point for verification logic
+      *----------------------------------------------------------------*
+       TEST-VERIFY-SIGNATURE.
+      *    Test digits-only fingerprint (existing behavior)
+           MOVE WS-TEST-DIGITS-ONLY TO WS-CERT-FINGERPRINT
+           MOVE WS-TEST-DIGITS-ONLY TO CS-CERT-FINGERPRINT
+           PERFORM VERIFY-SIGNATURE
+      *
+      *    Test A-F hex characters (new test case)
+           MOVE WS-TEST-AF-HEX TO WS-CERT-FINGERPRINT
+           MOVE WS-TEST-AF-HEX TO CS-CERT-FINGERPRINT
+           PERFORM VERIFY-SIGNATURE
+      *
+      *    Test mixed hex with consecutive A-F characters
+           MOVE WS-TEST-MIXED-HEX TO WS-CERT-FINGERPRINT
+           MOVE WS-TEST-MIX