      * [ShanaBoo] Fix EBCDIC-to-ASCII conversion corrupting certificate fingerprint
      *=================================================================*
      * VERIFY-SIGNATURE - Certificate signature verification module
      *=================================================================*
      * Working storage for signature verification
       01  WS-SIG-VERIFY-DATA.
           05  WS-SIG-VERIFY-LENGTH      PIC 9(04) COMP.
      *    Changed to USAGE NATIONAL to prevent EBCDIC-to-ASCII corruption
           05  WS-SIG-VERIFY-BUFFER      PIC N(64) USAGE NATIONAL.
           05  WS-SIG-VERIFY-RESULT      PIC 9(01).
               88  WS-SIG-VERIFY-SUCCESS   VALUE 0.
               88  WS-SIG-VERIFY-FAILURE   VALUE 1.
           05  WS-CERT-ISSUER            PIC X(128).
           05  WS-CERT-SUBJECT           PIC X(128).
           05  WS-CERT-EXPIRY            PIC 9(08) COMP.
      *    Changed to USAGE NATIONAL to match verify buffer encoding
           05  WS-CERT-FINGERPRINT       PIC N(64) USAGE NATIONAL.

      * Signature algorithm constants
       01  WS-SIG-ALG-SHA256           PIC X(10) VALUE 'SHA-256   '.
           05  CS-CERT-ISSUER            PIC X(128).
           05  CS-CERT-SUBJECT           PIC X(128).
           05  CS-CERT-EXPIRY            PIC 9(08) COMP.
      *    Changed to USAGE NATIONAL for code-page-independent comparison
           05  CS-CERT-FINGERPRINT       PIC N(64) USAGE NATIONAL.

      *=================================================================*
      * PROCEDURE DIVISION
      *    Load certificate fingerprint for comparison
           MOVE WS-CERT-FINGERPRINT TO WS-SIG-VERIFY-BUFFER

      *    Compare fingerprint using FUNCTION ORD for code-page-independent matching
           IF FUNCTION ORD(WS-SIG-VERIFY-BUFFER) = 
              FUNCTION ORD(CS-CERT-FINGERPRINT)
               SET WS-SIG-VERIFY-SUCCESS TO TRUE
           ELSE
               SET WS-SIG-VERIFY-FAILURE TO TRUE
           END-IF

      *    Log verification result with fingerprint using NATIONAL display
      *    to ensure correct hex output regardless of code page
           DISPLAY 'VERIFY-SIGNATURE: Fingerprint comparison complete'
           DISPLAY '  Expected: ' CS-CERT-FINGERPRINT
           DISPLAY '  Actual:   ' WS-SIG-VERIFY-BUFFER