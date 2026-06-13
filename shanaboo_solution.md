 ```diff
--- a/cobol/verify-signature.cbl
+++ b/cobol/verify-signature.cbl
@@ -1,3 +1,8 @@
+      * ============================================================
+      * VERIFY-SIGNATURE paragraph
+      * Fixed EBCDIC-to-ASCII conversion for certificate fingerprint
+      * ============================================================
+
        IDENTIFICATION DIVISION.
        PROGRAM-ID. VERIFY-SIGNATURE.
 
@@ -50,7 +55,8 @@
            05  WS-SIG-VERIFY-BUFFER-LEN PIC 9(4) COMP.
 
       *    Working buffer for fingerprint comparison
-       01  WS-SIG-VERIFY-BUFFER      PIC X(64).
+       01  WS-SIG-VERIFY-BUFFER      PIC X(64) USAGE NATIONAL.
+       01  WS-SIG-VERIFY-DISPLAY     PIC X(64).
 
       * ============================================================
       * Local Storage Section
@@ -58,7 +64,7 @@
        LOCAL-STORAGE SECTION.
 
       *    Certificate fingerprint from certificate store
-       01  CS-CERT-FINGERPRINT         PIC X(64).
+       01  CS-CERT-FINGERPRINT         PIC X(64) USAGE NATIONAL.
 
       *    Loop index for byte-by-byte comparison
        01  WS-BYTE-INDEX               PIC 9(2) COMP.
@@ -229,14 +235,20 @@
       *    Load certificate fingerprint from store
            MOVE CS-CERT-FINGERPRINT-IN TO CS-CERT-FINGERPRINT
 
-      *    Move fingerprint to verification buffer
-           MOVE WS-CERT-FINGERPRINT TO WS-SIG-VERIFY-BUFFER
+      *    Move fingerprint to verification buffer with NATIONAL
+      *    encoding to prevent EBCDIC-to-ASCII conversion issues
+           MOVE FUNCTION NATIONAL(WS-CERT-FINGERPRINT)
+             TO WS-SIG-VERIFY-BUFFER
+
+      *    Prepare display buffer for logging (ASCII/EBCDIC safe)
+           MOVE FUNCTION DISPLAY-OF(WS-SIG-VERIFY-BUFFER)
+             TO WS-SIG-VERIFY-DISPLAY
 
       *    Compare fingerprints using code-page-independent method
       *    FUNCTION ORD ensures consistent comparison regardless
       *    of platform encoding
-           IF WS-SIG-VERIFY-BUFFER = CS-CERT-FINGERPRINT THEN
+           IF FUNCTION ORD(WS-SIG-VERIFY-BUFFER) =
+              FUNCTION ORD(CS-CERT-FINGERPRINT) THEN
                SET WS-VERIFY-SUCCESS TO TRUE
            ELSE
                SET WS-VERIFY-FAIL TO TRUE
@@ -244,7 +256,7 @@
 
       *    Log fingerprint for debugging
            DISPLAY "Certificate fingerprint: "
-               WS-SIG-VERIFY-BUFFER
+               WS-SIG-VERIFY-DISPLAY
 
       *    Return verification result
            IF WS-VERIFY-SUCCESS THEN
@@ -258,3 +270,4 @@
            .
 
        END PROGRAM VERIFY-SIGNATURE.
+
--- /dev/null
+++ b/cobol/tests/test-verify-signature.cbl
@@ -0,0 +1,120 @@
+      * ============================================================
+      * Test suite for VERIFY-SIGNATURE paragraph
+      * Tests EBCDIC-safe fingerprint comparison
+      * ============================================================
+
+       IDENTIFICATION DIVISION.
+       PROGRAM-ID. TEST-VERIFY-SIGNATURE.
+
+       ENVIRONMENT DIVISION.
+       CONFIGURATION SECTION.
+       SOURCE-COMPUTER. IBM-370.
+       OBJECT-COMPUTER. IBM-370.
+
+       DATA DIVISION.
+       WORKING-STORAGE SECTION.
+
+      * Test result indicators
+       01  TEST-PASSED                 PIC X(5) VALUE 'PASS '.
+       01  TEST-FAILED                 PIC X(5) VALUE 'FAIL '.
+       01  TEST-RESULT                 PIC X(5).
+
+      * Test description
+       01  TEST-NAME                   PIC X(50).
+
+      * Test fingerprints
+       01  TEST-FINGERPRINT-ALL-DIGITS PIC X(64) VALUE
+           '1234567890123456789012345678901234567890'.
+       01  TEST-FINGERPRINT-AF-HEX       PIC X(64) VALUE
+           'AABBCCDDEEFF00112233445566778899AABBCCDD'.
+       01  TEST-FINGERPRINT-MIXED        PIC X(64) VALUE
+           'DEADBEEFCAFE1234567890ABCDEF1234567890AB'.
+       01  TEST-FINGERPRINT-CONSECUTIVE-AF PIC X(64) VALUE
+           'AABBCCDDEEFFAABBCCDDEEFFAABBCCDDEEFF1122'.
+
+      * Expected results
+       01  EXPECTED-RESULT             PIC X(1).
+       01  ACTUAL-RESULT               PIC X(1).
+
+      * Counter for test summary
+       01  TESTS-RUN                   PIC 9(3) VALUE 0.
+       01  TESTS-PASSED                PIC 9(3) VALUE 0.
+       01  TESTS-FAILED                PIC 9(3) VALUE 0.
+
+       PROCEDURE DIVISION.
+
+      * ============================================================
+      * Main test driver
+      * ============================================================
+       MAIN-TEST-SECTION.
+           DISPLAY '========================================'
+           DISPLAY 'VERIFY-SIGNATURE Test Suite'
+           DISPLAY '========================================'
+           DISPLAY ' '
+
+      *    Test 1: All digits fingerprint (0-9)
+           MOVE 'All digits fingerprint verification' TO TEST-NAME
+           MOVE 'Y' TO EXPECTED-RESULT
+           PERFORM RUN-TEST-ALL-DIGITS
+
+      *    Test 2: A-F hex characters fingerprint
+           MOVE 'A-F hex characters fingerprint verification' TO TEST-NAME
+           MOVE 'Y' TO EXPECTED-RESULT
+           PERFORM RUN-TEST-AF-HEX
+
+      *    Test 3: Mixed hex with DEADBEEF pattern
+           MOVE 'Mixed hex DEADBEEF fingerprint verification'
+             TO TEST-NAME
+           MOVE 'Y' TO EXPECTED-RESULT
+           PERFORM RUN-TEST-MIXED
+
+      *    Test 4: Consecutive A-F characters (bounty requirement)
+           MOVE 'Consecutive A-F characters fingerprint verification'
+             TO TEST-NAME
+           MOVE 'Y' TO EXPECTED-RESULT
+           PERFORM RUN-TEST-CONSECUTIVE-AF
+
+      *    Test 5: Mismatch case (should fail)
+           MOVE 'Fingerprint mismatch detection' TO TEST-NAME
+           MOVE 'N' TO EXPECTED-RESULT
+           PERFORM RUN-