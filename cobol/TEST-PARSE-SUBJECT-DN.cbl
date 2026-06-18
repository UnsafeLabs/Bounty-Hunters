       IDENTIFICATION DIVISION.
       PROGRAM-ID. TEST-PARSE-SUBJECT-DN.
       AUTHOR. MAINFRAME-SECURITY-TEAM.
      *================================================================
      * UNIT TEST DRIVER FOR THE REAL PARSE-SUBJECT-DN SUBPROGRAM
      * (ISSUE #521). IT DOES NOT RE-IMPLEMENT THE PARSE LOGIC: IT
      * CALLS THE PRODUCTION SUBPROGRAM AND ASSERTS ON ITS OUTPUTS.
      *
      * CASES REQUIRED BY THE ACCEPTANCE CRITERIA:
      *   1. CN WITH A SINGLE ESCAPED COMMA   -> "Smith, John"
      *   2. CN WITH MULTIPLE ESCAPED COMMAS  -> "Doe, Jane, Esq"
      *   3. CN WITH NO COMMAS                -> "secure.example.com"
      * EACH CASE ASSERTS BOTH THE PARSED CN AND THE RDN COUNT (THE
      * COUNT MUST NOT BE INFLATED BY ESCAPED DELIMITERS).
      *
      * RETURN-CODE IS 0 WHEN ALL CASES PASS, 8 OTHERWISE.
      *================================================================
       ENVIRONMENT DIVISION.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WS-IN-DN            PIC X(256).
       01  WS-OUT-CN           PIC X(64).
       01  WS-OUT-COUNT        PIC 9(2).
       01  WS-EXP-CN           PIC X(64).
       01  WS-EXP-COUNT        PIC 9(2).
       01  WS-CASE-NAME        PIC X(40).
       01  WS-FAILURES         PIC 9(2)  VALUE 0.
       PROCEDURE DIVISION.
       0000-RUN-TESTS.
           MOVE 'single escaped comma' TO WS-CASE-NAME
           MOVE 'CN=Smith\, John,OU=Legal,O=Acme Bank'
               TO WS-IN-DN
           MOVE 'Smith, John' TO WS-EXP-CN
           MOVE 3 TO WS-EXP-COUNT
           PERFORM 1000-RUN-CASE

           MOVE 'multiple escaped commas' TO WS-CASE-NAME
           MOVE 'CN=Doe\, Jane\, Esq,OU=Law,C=US' TO WS-IN-DN
           MOVE 'Doe, Jane, Esq' TO WS-EXP-CN
           MOVE 3 TO WS-EXP-COUNT
           PERFORM 1000-RUN-CASE

           MOVE 'no commas' TO WS-CASE-NAME
           MOVE 'CN=secure.example.com,OU=IT,O=Acme' TO WS-IN-DN
           MOVE 'secure.example.com' TO WS-EXP-CN
           MOVE 3 TO WS-EXP-COUNT
           PERFORM 1000-RUN-CASE

           IF WS-FAILURES = 0
               DISPLAY 'ALL TESTS PASSED'
               MOVE 0 TO RETURN-CODE
           ELSE
               DISPLAY WS-FAILURES ' TEST(S) FAILED'
               MOVE 8 TO RETURN-CODE
           END-IF
           STOP RUN
           .
       1000-RUN-CASE.
           MOVE SPACES TO WS-OUT-CN
           MOVE 0 TO WS-OUT-COUNT
           CALL 'PARSE-SUBJECT-DN' USING WS-IN-DN WS-OUT-CN
               WS-OUT-COUNT
           IF WS-OUT-CN = WS-EXP-CN AND WS-OUT-COUNT = WS-EXP-COUNT
               DISPLAY 'PASS: ' WS-CASE-NAME
           ELSE
               ADD 1 TO WS-FAILURES
               DISPLAY 'FAIL: ' WS-CASE-NAME
               DISPLAY '  EXPECTED CN=[' WS-EXP-CN
                   '] COUNT=' WS-EXP-COUNT
               DISPLAY '  ACTUAL   CN=[' WS-OUT-CN
                   '] COUNT=' WS-OUT-COUNT
           END-IF
           .
