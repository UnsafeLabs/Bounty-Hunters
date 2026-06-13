      *=================================================================*
      * 3500-PARSE-SUBJECT-DN
      * Parse certificate Subject DN into RDN components
      *=================================================================*
       01  WS-RDN-INDEX              PIC 9(3)  COMP.
       01  WS-CHAR-INDEX             PIC 9(3)  COMP.
       01  WS-CURRENT-RDN              PIC X(256).
       01  WS-ESCAPED-COMMA-IDX        PIC 9(3)  COMP.
       01  WS-PLACEHOLDER-CHAR         PIC X     VALUE X'1F'.
       01  WS-TEMP-CHAR                PIC X.

      * RDN Table - holds parsed RDN components
       01  WS-RDN-TABLE.
       01  WS-PARSED-CN                PIC X(64).
       01  WS-CN-FOUND                 PIC X     VALUE 'N'.
       01  WS-RDN-COUNT                PIC 9(3)  COMP.
       01  WS-REAL-RDN-COUNT           PIC 9(3)  COMP.

      * Working storage for UNSTRING
       01  WS-UNSTRING-PTR             PIC 9(3)  COMP.
       01  WS-TEMP-RDN                 PIC X(256).
       01  WS-DELIMITER-COUNT          PIC 9(3)  COMP.

      * Placeholder tracking for escaped commas
       01  WS-PLACEHOLDER-TABLE.
           05  WS-PLACEHOLDER-ENTRY    PIC 9(3)  COMP OCCURS 99 TIMES.

       LINKAGE SECTION.
       01  LK-SUBJECT-DN               PIC X(512).
       01  LK-RDN-TABLE.
       3500-MAIN.
           MOVE 'N' TO WS-CN-FOUND
           MOVE SPACES TO WS-PARSED-CN
           MOVE SPACES TO WS-RDN-TABLE
           MOVE ZERO TO WS-RDN-COUNT
           MOVE ZERO TO WS-REAL-RDN-COUNT
           MOVE ZERO TO WS-ESCAPED-COMMA-IDX
           .

       3510-PREPROCESS-ESCAPED-COMMAS.
      * Replace escaped commas with placeholder to protect during UNSTRING
           PERFORM VARYING WS-CHAR-INDEX FROM 1 BY 1
               UNTIL WS-CHAR-INDEX > LENGTH OF WS-WORK-DN
               IF WS-WORK-DN(WS-CHAR-INDEX:2) = '\,'
                   MOVE WS-PLACEHOLDER-CHAR TO WS-WORK-DN(WS-CHAR-INDEX:1)
                   ADD 1 TO WS-ESCAPED-COMMA-IDX
                   MOVE WS-CHAR-INDEX TO WS-PLACEHOLDER-ENTRY(WS-ESCAPED-COMMA-IDX)
               END-IF
           END-PERFORM
           .

       3520-SPLIT-RDNS.
           MOVE 1 TO WS-UNSTRING-PTR
           MOVE ZERO TO WS-DELIMITER-COUNT

           UNSTRING WS-WORK-DN DELIMITED BY ALL ','
               INTO WS-TEMP-RDN
               WITH POINTER WS-UNSTRING-PTR
               TALLYING IN WS-DELIMITER-COUNT
               NOT ON OVERFLOW
                   ADD 1 TO WS-RDN-COUNT
           END-UNSTRING

      * Restore escaped commas in each RDN
           PERFORM 3530-RESTORE-ESCAPED-COMMAS
           .

       3525-PARSE-RDN-LOOP.
           END-PERFORM
           .

       3530-RESTORE-ESCAPED-COMMAS.
      * Replace placeholders back with commas in each RDN
           PERFORM VARYING WS-RDN-INDEX FROM 1 BY 1
               UNTIL WS-RDN-INDEX > WS-RDN-COUNT
               PERFORM VARYING WS-CHAR-INDEX FROM 1 BY 1
                   UNTIL WS-CHAR-INDEX > LENGTH OF WS-RDN-ENTRY(WS-RDN-INDEX)
                   IF WS-RDN-ENTRY(WS-RDN-INDEX)(WS-CHAR-INDEX:1) = WS-PLACEHOLDER-CHAR
                       MOVE ',' TO WS-RDN-ENTRY(WS-RDN-INDEX)(WS-CHAR-INDEX:1)
                   END-IF
               END-PERFORM
           END-PERFORM
      * Recalculate actual RDN count (excluding those created by escaped commas)
           COMPUTE WS-REAL-RDN-COUNT = WS-RDN-COUNT - WS-ESCAPED-COMMA-IDX
           MOVE WS-REAL-RDN-COUNT TO WS-RDN-COUNT
           .

       3540-EXTRACT-CN.
      * Extract Common Name from RDN
           IF WS-RDN-ENTRY(WS-RDN-INDEX)(1:3) = 'CN='
           MOVE WS-RDN-COUNT TO LK-RDN-COUNT
           MOVE WS-PARSED-CN TO LK-PARSED-CN
           MOVE WS-CN-FOUND TO LK-CN-FOUND
           MOVE WS-RDN-COUNT TO LK-RDN-COUNT
           .

       3599-EXIT.