      ******************************************************************
      * VERIFY-SIGNATURE.cbl - Certificate signature verification
      ******************************************************************
       IDENTIFICATION DIVISION.
       PROGRAM-ID. VERIFY-SIGNATURE.
           05  WS-CERT-FINGERPRINT      PIC X(64) VALUE SPACES.
           05  WS-VERIFY-RESULT         PIC 9 VALUE 0.
           05  WS-VERIFY-STATUS         PIC X(20) VALUE SPACES.
           05  WS-SIG-VERIFY-BUFFER     PIC X(64) VALUE SPACES.
           05  WS-SIG-VERIFY-BUFFER-N   PIC N(64) VALUE SPACES.
           05  WS-SIG-INDEX             PIC 9(4) VALUE 0.
           05  WS-SIG-LENGTH            PIC 9(4) VALUE 64.
           05  WS-HEX-BYTE              PIC X(2) VALUE SPACES.
      *    VERIFY-SIGNATURE paragraph
      ******************************************************************
       VERIFY-SIGNATURE.
      *    Move fingerprint to verification buffer with NATIONAL
      *    encoding to prevent EBCDIC-to-ASCII corruption
           MOVE FUNCTION DISPLAY-OF (
               FUNCTION NATIONAL-OF (WS-CERT-FINGERPRINT)
           ) TO WS-SIG-VERIFY-BUFFER
           
      *    Also store in NATIONAL buffer for code-page-independent
      *    comparison
           MOVE FUNCTION NATIONAL-OF (WS-CERT-FINGERPRINT)
               TO WS-SIG-VERIFY-BUFFER-N
           
      *    Validate fingerprint format (64 hex characters)
           PERFORM VARYING WS-SIG-INDEX FROM 1 BY 1
                   UNTIL WS-SIG-INDEX > WS-SIG-LENGTH
               IF WS-SIG-VERIFY-BUFFER(WS-SIG-INDEX:1) NOT = '0' AND
                  WS-SIG-VERIFY-BUFFER(WS-SIG-INDEX:1) NOT = '1' AND
                  WS-SIG-VERIFY-BUFFER(WS-SIG-INDEX:1) NOT = '2' AND
                  WS-SIG-VERIFY-BUFFER(WS-SIG-INDEX:1) NOT = '3' AND
                  WS-SIG-VERIFY-BUFFER(WS-SIG-INDEX:1) NOT = 'A' AND
                  WS-SIG-VERIFY-BUFFER(WS-SIG-INDEX:1) NOT = 'B' AND
                  WS-SIG-VERIFY-BUFFER(WS-SIG-INDEX:1) NOT = 'C' AND
                  WS-SIG-VERIFY-BUFFER(WS-SIG-INDEX:1) NOT = 'D' AND
                  WS-SIG-VERIFY-BUFFER(WS-SIG-INDEX:1) NOT = 'E' AND
                  WS-SIG-VERIFY-BUFFER(WS-SIG-INDEX:1) NOT = 'F'
                   MOVE 1 TO WS-VERIFY-RESULT
                   MOVE 'INVALID FINGERPRINT' TO WS-VERIFY-STATUS
                   EXIT PERFORM
               END-IF
           END-PERFORM
           
      *    Perform code-page-independent comparison using ORD
           IF WS-VERIFY-RESULT = 0
               PERFORM CODE-PAGE-INDEPENDENT-COMPARE
           END-IF
      *    Log verification result
           IF WS-VERIFY-RESULT = 0
               MOVE 'VERIFICATION PASSED' TO WS-VERIFY-STATUS
               DISPLAY 'Fingerprint verified: ' 
                   FUNCTION DISPLAY-OF (WS-SIG-VERIFY-BUFFER-N)
           ELSE
               DISPLAY 'Fingerprint verification failed'
           END-IF
           .
       
       CODE-PAGE-INDEPENDENT-COMPARE.
      *    Compare fingerprints using FUNCTION ORD for each byte
      *    to avoid EBCDIC/ASCII code point differences
           MOVE 0 TO WS-VERIFY-RESULT
           PERFORM VARYING WS-SIG-INDEX FROM 1 BY 1
                   UNTIL WS-SIG-INDEX > WS-SIG-LENGTH
               IF FUNCTION ORD (WS-SIG-VERIFY-BUFFER-N(WS-SIG-INDEX:1))
                  NOT = 
                  FUNCTION ORD (FUNCTION NATIONAL-OF (
                      CS-CERT-FINGERPRINT(WS-SIG-INDEX:1)))
                   MOVE 1 TO WS-VERIFY-RESULT
                   MOVE 'FINGERPRINT MISMATCH' TO WS-VERIFY-STATUS
                   EXIT PERFORM
               END-IF
           END-PERFORM
           .