 ```diff
--- a/cobol/verify-signature.cbl
+++ b/cobol/verify-signature.cbl
@@ -1,0 +1,150 @@
+       IDENTIFICATION DIVISION.
+       PROGRAM-ID. VERIFY-SIGNATURE.
+      *
+      * Copyright (c) UnsafeLabs. All rights reserved.
+      * Licensed under the MIT License.
+      *
+      * This program verifies certificate signatures for the
+      * Bounty-Hunters security module.
+      *
+       ENVIRONMENT DIVISION.
+       CONFIGURATION SECTION.
+       SOURCE-COMPUTER. IBM-370.
+       OBJECT-COMPUTER. IBM-370.
+       SPECIAL-NAMES.
+           C01 IS TOP-OF-PAGE.
+      *
+       DATA DIVISION.
+       WORKING-STORAGE SECTION.
+      *
+      * Input/Output fields for certificate operations
+       01  WS-CERT-FINGERPRINT        PIC X(64) USAGE DISPLAY.
+       01  WS-SIG-VERIFY-BUFFER       PIC X(64) USAGE DISPLAY.
+       01  WS-EXPECTED-FINGERPRINT    PIC X(64) USAGE DISPLAY.
+      *
+      * Code-page independent comparison fields
+       01  WS-IDX                     PIC 9(4) COMP.
+       01  WS-MATCH-FLAG              PIC X VALUE 'N'.
+           88  WS-MATCH-YES           VALUE 'Y'.
+           88  WS-MATCH-NO            VALUE 'N'.
+       01  WS-ORD-1                   PIC 9(4) COMP.
+       01  WS-ORD-2                   PIC 9(4) COMP.
+      *
+      * Test case fields
+       01  WS-TEST-FINGERPRINT-1      PIC X(64) VALUE
+           "AABBCCDDEEFF00112233445566778899AABBCCDDEEFF0011223344556677".
+       01  WS-TEST-FINGERPRINT-2      PIC X(64) VALUE
+           "000000000000000000000000000000000000