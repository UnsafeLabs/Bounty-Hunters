 ; TLS utility fixes for naked reference cascade (issue #562)
 ; Fully-qualified sets; $DATA#2 for real data; timed XTMP cleanup
 ;
CERT(X) ; entry: set fully-qualified globals, never rely on naked after branch
 NEW NODE
 SET NODE=$GET(X)
 IF NODE="" SET ^GLBTLS($J,"CERT","ERR")=1 QUIT 0
 ; Explicit IF instead of post-conditional naked risk
 IF $DATA(^GLBTLS($J,"CERT",NODE))#2 DO
 . SET ^GLBTLS($J,"CERT","CUR")=NODE
 . SET ^GLBTLS($J,"CERT","OK")=1
 ELSE  DO
 . SET ^GLBTLS($J,"CERT","CUR")=""
 . SET ^GLBTLS($J,"CERT","OK")=0
 ; Re-anchor naked reference safely if needed by dummy read
 SET %=$GET(^GLBTLS($J,"CERT","CUR"))
 QUIT $GET(^GLBTLS($J,"CERT","OK"),0)
 ;
VERIFY(FP) ; fingerprint verify without KILL-before-naked hazard
 NEW OK
 IF FP="" QUIT 0
 ; Use $DATA#2 so phantom descendants do not count as data
 IF $DATA(^GLBTLS($J,"FP",FP))#2 DO
 . SET OK=1
 . SET ^GLBTLS($J,"FP","LAST")=FP
 ELSE  SET OK=0
 ; Fully-qualified SET only (no naked after KILL)
 QUIT OK
 ;
CLEAN ; cleanup ^XTMP("TLSHASH") older than 24h for all jobs
 NEW J,TS,NOW,N
 SET NOW=+$HOROLOG
 SET J=""
 FOR  SET J=$ORDER(^XTMP("TLSHASH",J)) QUIT:J=""  DO
 . SET TS=+$GET(^XTMP("TLSHASH",J,"TS"),0)
 . IF TS>0,(NOW-TS)>1 KILL ^XTMP("TLSHASH",J)
 QUIT
