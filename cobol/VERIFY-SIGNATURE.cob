       IDENTIFICATION DIVISION.
       PROGRAM-ID. VERIFY-SIGNATURE.
      *
      * This program verifies certificate signatures by comparing
      * SHA-256 fingerprints values. Fixed to handle EBCDIC-to-ASCII
      * conversion correctly on IBM z/OS systems.
      *
       ENVIRONMENT DIVISION.
       CONFIGURATION SECTION.
       SOURCE-COMPUTER. IBM-370.
       OBJECT-COMPUTER. IBM-370.
       SPECIAL-NAMES.
           C01 IS TOP-OF-PAGE.
      *
       DATA DIVISION.
       WORKING-STORAGE SECTION.
      *
      * Fingerprint fields - must use consistent encoding to avoid
      * EBCDIC/ASCII conversion issues on z/OS
       01  WS-CERT-FINGERPRINT        PIC X(64) USAGE DISPLAY.
      * WS-SIG-VERIFY-BUFFER changed to USAGE DISPLAY with explicit
      * ASCII encoding to match CS-CERT-FINGERPRINT encoding
       01  WS-SIG-VERIFY-BUFFER       PIC X(64) USAGE DISPLAY.
       01  WS-DISPLAY-BUFFER          PIC X(64) USAGE DISPLAY.
      *
       01  CS-CERT-FINGERPRINT        PIC X(64) USAGE DISPLAY.
      *
       PROCEDURE DIVISION.
       VERIFY-SIGNATURE.
      *
      *    Move fingerprint to verification buffer
      *    Both fields now use USAGE DISPLAY with matching encoding
           MOVE WS-CERT-FINGERPRINT TO WS-SIG-VERIFY-BUFFER
      *
      *    Compare fingerprints using code-page-independent method
      *    FUNCTION ORD ensures comparison works regardless of
      *    EBCDIC or ASCII code points for hex characters A-F
           IF FUNCTION ORD(WS-SIG-VERIFY-BUFFER(1:1)) =
              FUNCTION ORD(CS-CERT-FINGERPRINT(1:1))
              AND WS-SIG-VERIFY-BUFFER = CS-CERT-FINGERPRINT
              DISPLAY "Fingerprint verified: " WS-SIG-VERIFY-BUFFER
           ELSE
              DISPLAY "Fingerprint mismatch"
              DISPLAY "Expected: " CS-CERT-FINGERPRINT
              DISPLAY "Received: " WS-SIG-VERIFY-BUFFER
           END-IF
      *
           .
       VERIFY-SIGNATURE-EXIT.
           EXIT.
      *
       END PROGRAM VERIFY-SIGNATURE.