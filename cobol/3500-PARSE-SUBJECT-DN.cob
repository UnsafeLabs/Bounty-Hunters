      ******************************************************************
      * 3500-PARSE-SUBJECT-DN.cob
      *
      * Parse certificate Subject DN into RDN components and extract
      * the Common Name for hostname matching.
      *   WS-RDN-TABLE
      *   WS-RDN-COUNT
      *   WS-PARSED-CN
      *   WS-WORK-DN
      *   WS-RESTORE-DN
      *
     ******************************************************************

       01  WS-RDN-ENTRY          PIC X(256).
       01  WS-RDN-IDX            PIC 9(3) COMP.
       01  WS-CN-POS             PIC 9(4) COMP.
       01  WS-WORK-DN            PIC X(1024).
       01  WS-RESTORE-DN         PIC X(1024).
       01  WS-ESCAPE-IDX         PIC 9(4) COMP.

      * RDN table for parsed components
       01  WS-RDN-TABLE.
      * Initialize output fields
           INITIALIZE WS-RDN-TABLE
           INITIALIZE WS-PARSED-CN
           INITIALIZE WS-WORK-DN
           INITIALIZE WS-RESTORE-DN
           INITIALIZE WS-RDN-COUNT
           MOVE 0 TO WS-RDN-COUNT

      * Validate input
               GO TO 3500-EXIT
           END-IF

      * Pre-process DN: replace escaped commas with placeholder
      * to prevent incorrect splitting
           MOVE WS-SUBJECT-COMMON-NAME TO WS-WORK-DN
           INSPECT WS-WORK-DN
               REPLACING ALL '\,' BY X'01'

      * Also handle quoted form with backslash-escaped comma
           INSPECT WS-WORK-DN
               REPLACING ALL '\,' BY X'01'

      * Handle case where escaped comma appears as "\," in quotes
           MOVE 1 TO WS-ESCAPE-IDX
           PERFORM UNTIL WS-ESCAPE-IDX > 1024
               IF WS-WORK-DN(WS-ESCAPE-IDX:2) = '\,'
                   MOVE X'01' TO WS-WORK-DN(WS-ESCAPE-IDX:1)
                   MOVE ',' TO WS-WORK-DN(WS-ESCAPE-IDX + 1:1)
               END-IF
               ADD 1 TO WS-ESCAPE-IDX
           END-PERFORM

      * Save copy for restoration
           MOVE WS-WORK-DN TO WS-RESTORE-DN

      * Replace placeholder with comma for any remaining processing
           INSPECT WS-WORK-DN
               REPLACING ALL X'01' BY ','

      * Now split DN into RDN components using comma delimiter
      * Use the pre-processed work DN that has placeholders for
      * escaped commas
           UNSTRING WS-WORK-DN DELIMITED BY ','
               INTO WS-RDN-1, WS-RDN-2, WS-RDN-3,
                    WS-RDN-4, WS-RDN-5, WS-RDN-6,
                    WS-RDN-7, WS-RDN-8, WS-RDN-9,
               TALLYING IN WS-RDN-COUNT
           END-UNSTRING

      * Re-initialize work area with restored commas
           MOVE WS-RESTORE-DN TO WS-WORK-DN

      * Trim and parse each RDN to find CN=
           PERFORM VARYING WS-RDN-IDX FROM 1 BY 1
                   UNTIL WS-RDN-IDX > WS-RDN-COUNT
               IF WS-RDN-ENTRY(1:3) = 'CN=' OR
                  WS-RDN-ENTRY(1:3) = 'cn='

      * Restore escaped commas in this RDN before extracting CN
                   INSPECT WS-RDN-ENTRY
                       REPLACING ALL X'01' BY ','

      * Extract the CN value (after CN=)
                   MOVE WS-RDN-ENTRY(4:) TO WS-PARSED-CN

                       INSPECT WS-PARSED-CN
                           REPLACING ALL '"' BY SPACE
                   END-IF

      * Restore escaped commas in final CN value
                   INSPECT WS-PARSED-CN
                       REPLACING ALL X'01' BY ','
               END-IF
           END-PERFORM

           .

      * End of 3500-PARSE-SUBJECT-DN
      ******************************************************************