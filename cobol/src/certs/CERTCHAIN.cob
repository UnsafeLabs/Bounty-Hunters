       IDENTIFICATION DIVISION.
       PROGRAM-ID. CERTCHAIN.
      * Fix: OCCURS DEPENDING ON causing S0C4 abend
      * when certificate chain has variable depth (#516)
      *
      * Problem: OCCURS DEPENDING ON with invalid or
      * zero DEPENDING value causes S0C4 abend.
      *
      * Solution: Validate DEPENDING value before use,
      * set minimum of 1, add bounds checking, and
      * handle zero-length chains gracefully.

       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  CERT-CHAIN-COUNT         PIC 9(4) VALUE 0.
           88  NO-CERTS             VALUE 0.
           88  VALID-CERT-COUNT     VALUE 1 THRU 100.
       01  MAX-CERT-DEPTH           PIC 9(4) VALUE 100.
       01  CERT-INDEX               PIC 9(4) VALUE 1.
       01  CERT-CHAIN-TABLE.
           05  CERT-ENTRY OCCURS 1 TO 100 TIMES
               DEPENDING ON CERT-CHAIN-COUNT
               INDEXED BY CERT-IDX.
               10  CERT-SUBJECT     PIC X(256).
               10  CERT-ISSUER      PIC X(256).
               10  CERT-SERIAL      PIC X(32).
               10  CERT-NOT-BEFORE  PIC X(16).
               10  CERT-NOT-AFTER   PIC X(16).
       01  ABEND-FLAG               PIC X VALUE "N".
           88  ABEND-PREVENTED      VALUE "Y".

       LINKAGE SECTION.
       01  LS-CHAIN-DEPTH           PIC 9(4).
       01  LS-RETURN-CODE           PIC 9 VALUE 0.
           88  RC-OK                VALUE 0.
           88  RC-INVALID-DEPTH     VALUE 1.
           88  RC-ABEND-PREVENTED   VALUE 2.

       PROCEDURE DIVISION USING LS-CHAIN-DEPTH
                                 LS-RETURN-CODE.
       MAIN-LOGIC.
           SET RC-OK TO TRUE
           SET ABEND-PREVENTED TO FALSE

           PERFORM VALIDATE-CHAIN-DEPTH
           PERFORM PROCESS-CERT-CHAIN

           GOBACK.

       VALIDATE-CHAIN-DEPTH.
      *    Prevent S0C4 by ensuring DEPENDING value is valid
           IF LS-CHAIN-DEPTH < 0
               MOVE 1 TO CERT-CHAIN-COUNT
               SET RC-INVALID-DEPTH TO TRUE
               SET ABEND-PREVENTED TO TRUE
           ELSE IF LS-CHAIN-DEPTH = 0
               MOVE 1 TO CERT-CHAIN-COUNT
               SET RC-INVALID-DEPTH TO TRUE
               SET ABEND-PREVENTED TO TRUE
           ELSE IF LS-CHAIN-DEPTH > MAX-CERT-DEPTH
               MOVE MAX-CERT-DEPTH TO CERT-CHAIN-COUNT
               SET RC-INVALID-DEPTH TO TRUE
               SET ABEND-PREVENTED TO TRUE
           ELSE
               MOVE LS-CHAIN-DEPTH TO CERT-CHAIN-COUNT
           END-IF

           IF NOT VALID-CERT-COUNT
               MOVE 1 TO CERT-CHAIN-COUNT
           END-IF.

       PROCESS-CERT-CHAIN.
      *    Safe iteration with bounds checking
           PERFORM VARYING CERT-IDX FROM 1 BY 1
               UNTIL CERT-IDX > CERT-CHAIN-COUNT
               PERFORM VALIDATE-CERT-ENTRY
           END-PERFORM.

       VALIDATE-CERT-ENTRY.
      *    Bounds check before accessing table element
           IF CERT-IDX < 1 OR CERT-IDX > CERT-CHAIN-COUNT
               SET ABEND-PREVENTED TO TRUE
               SET RC-ABEND-PREVENTED TO TRUE
               EXIT PERFORM
           END-IF

           IF CERT-SUBJECT(CERT-IDX) = SPACES
               INITIALIZE CERT-ENTRY(CERT-IDX)
           END-IF.

       END PROGRAM CERTCHAIN.
