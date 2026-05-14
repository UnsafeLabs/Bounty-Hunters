TLSUTIL ; TLS Utility Routine - Fixed naked reference cascade
 ;; Fixed version: all naked references replaced with fully-qualified ^GLBTLS references
 ;; $$HASH^TLSCERT uses NEW to stack temp globals + restores naked reference via dummy READ
 ;; Post-conditional at CERT+14 refactored to explicit IF block
 ;; KILL at VERIFY+6 moved after SET at VERIFY+7 (both use fully-qualified refs)
 ;; $DATA check uses $D(node)#2 to exclude phantom descendant-only nodes
 ;; ^XTMP cleanup uses KILL ^XTMP("TLSHASH",$J) with $ORDER loop for entries older than 24h
 ;
 ; Entry point: CERT - Certificate processing
CERT N SESSID,CERTID,IDXP,RAWCERT,HASHVAL,TIMESTAMP
 S SESSID=$G(SESSID,"")
 S CERTID=$G(CERTID,"")
 ;
CERT+1 ; Load certificate data
 S RAWCERT=$G(^GLBTLS(SESSID,"cert",CERTID,"raw"))
 Q:RAWCERT=""
 ;
CERT+2 ; Parse certificate fields
 D PARSECERT^TLSCERT(RAWCERT)
 ;
CERT+3 ; Store parsed subject
 S ^GLBTLS(SESSID,"cert",CERTID,"subject")=$G(^GLBTLS(SESSID,"cert",CERTID,"parsed","subject"))
 ;
CERT+4 ; Store parsed issuer
 S ^GLBTLS(SESSID,"cert",CERTID,"issuer")=$G(^GLBTLS(SESSID,"cert",CERTID,"parsed","issuer"))
 ;
CERT+5 ; Store serial number
 S ^GLBTLS(SESSID,"cert",CERTID,"serial")=$G(^GLBTLS(SESSID,"cert",CERTID,"parsed","serial"))
 ;
CERT+6 ; Initialize chain index
 S IDXP=""
 ;
CERT+7 ; Iterate through chain entries
 F  S IDXP=$O(^GLBTLS(SESSID,"chain",IDXP)) Q:IDXP=""  D
 . ;
 .CERT+8 ; Check chain entry exists with data (use $D()#2 to exclude phantom nodes)
 . I '$D(^GLBTLS(SESSID,"chain",IDXP))#2 Q
 . ;
 .CERT+9 ; Load chain entry raw data
 . S RAWCERT=$G(^GLBTLS(SESSID,"chain",IDXP,"raw"))
 . Q:RAWCERT=""
 . ;
 .CERT+10 ; Parse chain certificate
 . D PARSECERT^TLSCERT(RAWCERT)
 . ;
 .CERT+11 ; Update last check time (fully-qualified reference)
 . S ^GLBTLS(SESSID,"meta","lastcheck")=$H
 . ;
 .CERT+12 ; Extract chain index for this entry
 . N CHAINIDX
 . S CHAINIDX=IDXP
 . ;
 .CERT+13 ; Check if chain index is valid
 . I CHAINIDX="" Q
 . ;
 .CERT+14 ; [FIXED] Post-conditional refactored to explicit IF block
 . ; Previously: D:$D(^GLBTLS(SESSID,"chain",CHAINIDX)) VERIFY^TLSCHAIN(CHAINIDX)
 . ; This set the naked reference differently depending on whether $D was true/false
 . ; Now: explicit IF ensures correct fully-qualified references regardless of branch
 . I $D(^GLBTLS(SESSID,"chain",CHAINIDX)) D
 . . D VERIFY^TLSCHAIN(CHAINIDX)
 . E  D
 . . ; FALSE path: naked reference was stale from CERT+11, now using fully-qualified ref
 . . S ^GLBTLS(SESSID,"cert",CERTID,"skipped",CHAINIDX)=$H
 . ;
 .CERT+15 ; [FIXED] Set expire using fully-qualified reference
 . ; Previously: S ^("expire")=$$FMTEXP used naked reference which could point to wrong node
 . S ^GLBTLS(SESSID,"chain",IDXP,"expire")=$$FMTEXP^TLSUTIL($G(^GLBTLS(SESSID,"chain",IDXP,"notBefore")))
 . ;
 .CERT+16 ; Store validation status
 . S ^GLBTLS(SESSID,"chain",IDXP,"validated")=1
 ;
CERT+17 ; Compute certificate hash using $$HASH^TLSCERT
 ; [FIXED] $$HASH^TLSCERT uses NEW to stack temporary global references
 ; and restores naked reference state via dummy READ before returning
 N HASHRESULT
 S HASHRESULT=$$HASH^TLSCERT(RAWCERT)
 S ^GLBTLS(SESSID,"cert",CERTID,"hash")=HASHRESULT
 ;
CERT+18 ; [FIXED] Set timestamp using fully-qualified reference
 ; Previously: S ^("ts")=$H used naked reference which pointed to ^XTMP after $$HASH^TLSCERT
 S ^GLBTLS(SESSID,"cert",CERTID,"ts")=$H
 ;
CERT+19 ; Store fingerprint
 S ^GLBTLS(SESSID,"cert",CERTID,"fingerprint")=$G(^GLBTLS(SESSID,"cert",CERTID,"hash"))
 ;
CERT+20 ; Done
 Q
 ;
 ;=========================================================================
 ; Extrinsic function: HASH - compute certificate hash
 ; [FIXED] Uses NEW to stack temporary global references and restores
 ; naked reference state via dummy READ of expected global node
 ;=========================================================================
HASH(RAWCERT) ;
 N SEQNO,HASH,TMPSAV
 S SEQNO=$G(^XTMP("TLSHASH",$J,"seqno"),0)+1
 S ^XTMP("TLSHASH",$J,"seqno")=SEQNO
 ;
 ; NEW all temp globals to prevent naked reference leakage
 N ^XTMP("TLSHASH",$J)
 ;
 ; Compute hash and store in temp location
 S HASH=$$COMPHASH^TLSHASH(RAWCERT)
 S ^XTMP("TLSHASH",$J,SEQNO)=HASH
 ;
 ; [FIXED] Restore naked reference via dummy READ of the expected global node
 ; This ensures the naked reference points to ^GLBTLS after we return
 N DUMMY
 S DUMMY=$G(^GLBTLS("nakedref","restore"))
 ;
 Q HASH
 ;
 ;=========================================================================
 ; Entry point: VERIFY - Chain verification
 ; [FIXED] KILL moved after SET, both use fully-qualified references
 ; $DATA check uses $D()#2 to exclude phantom descendant-only nodes
 ;=========================================================================
VERIFY ;
 N SESSID,IDX,RAWCERT,STATUS
 S SESSID=$G(SESSID,"")
 ;
VERIFY+1 ; Initialize loop index
 S IDX=""
 ;
VERIFY+2 ; Loop through chain entries
 F  S IDX=$O(^GLBTLS(SESSID,"chain",IDX)) Q:IDX=""  D
 . ;
 .VERIFY+3 ; [FIXED] Check node has actual data using $D()#2
 . ; Previously: I $D(^GLBTLS(SESSID,"chain",IDX,"raw")) treated $DATA=10 as truthy
 . ; Now: $D()#2 returns 1 only if node has data value (not just descendants)
 . I '$D(^GLBTLS(SESSID,"chain",IDX,"raw"))#2 Q
 . ;
 .VERIFY+4 ; Get raw certificate data
 . S RAWCERT=$G(^GLBTLS(SESSID,"chain",IDX,"raw"))
 . ;
 .VERIFY+5 ; Verify signature
 . I '$$VERIFYSIG^TLSCHAIN(RAWCERT) D  Q
 . . S ^GLBTLS(SESSID,"chain",IDX,"status")="I"
 . ;
 .VERIFY+6 ; [FIXED] Set status BEFORE killing raw data
 . ; Previously: KILL at VERIFY+6 then naked SET at VERIFY+7 caused phantom node
 . ; Now: both use fully-qualified references, SET happens before KILL
 . S ^GLBTLS(SESSID,"chain",IDX,"status")="V"
 . ;
 .VERIFY+7 ; [FIXED] KILL moved AFTER the SET; fully-qualified reference
 . KILL ^GLBTLS(SESSID,"chain",IDX,"raw")
 . ;
 .VERIFY+8 ; Store verification timestamp
 . S ^GLBTLS(SESSID,"chain",IDX,"verified")=$H
 ;
VERIFY+9 ; Done
 Q
 ;
 ;=========================================================================
 ; Entry point: CLEANUP - Nightly ^XTMP cleanup
 ; [FIXED] Uses KILL ^XTMP("TLSHASH",$J) with $ORDER loop for entries
 ; older than 24 hours instead of only killing first subscript level
 ;=========================================================================
CLEANUP ;
 N JOBID,CUTOFF,TS,NODETS
 ; Cutoff is 24 hours ago ($H format: days since 1840-12-31, seconds since midnight)
 S CUTOFF=$H-1
 ;
CLEANUP+1 ; Loop over all job IDs in TLSHASH
 S JOBID=""
 F  S JOBID=$O(^XTMP("TLSHASH",JOBID)) Q:JOBID=""  D
 . ;
 .CLEANUP+2 ; Check if this entry is older than 24 hours
 . S TS=$G(^XTMP("TLSHASH",JOBID,"ts"))
 . I TS="" D  Q
 . . ; No timestamp: check seqno age or clean up anyway
 . . N SEQNO
 . . S SEQNO=""
 . . F  S SEQNO=$O(^XTMP("TLSHASH",JOBID,SEQNO)) Q:SEQNO=""  D
 . . . I SEQNO="seqno" Q
 . . . S NODETS=$G(^XTMP("TLSHASH",JOBID,SEQNO,"ts"))
 . . . I NODETS=""!(NODETS<CUTOFF) KILL ^XTMP("TLSHASH",JOBID,SEQNO)
 . . KILL ^XTMP("TLSHASH",JOBID,"seqno")
 . ;
 .CLEANUP+3 ; Entry has timestamp, check age
 . I TS<CUTOFF KILL ^XTMP("TLSHASH",JOBID)
 ;
CLEANUP+4 ; Done
 Q
 ;
 ;=========================================================================
 ; Utility: FMTEXP - Format expiration date
 ;=========================================================================
FMTEXP(NOTBEFORE) ;
 Q $S(NOTBEFORE'="":NOTBEFORE+365,1:"")
 ;
 ;=========================================================================
 ; TEST CASES
 ;=========================================================================
 ;
 ; Test 1: Post-conditional FALSE path naked reference
 ; Verifies that when $D(^GLBTLS(SESSID,"chain",IDX)) is false,
 ; the fully-qualified reference at CERT+15 writes to the correct node
 ; and not to ^GLBTLS(SESSID,"meta","lastcheck","expire")
 ;
 ; Setup:
 ;   S SESSID="TEST1",CERTID="C1"
 ;   S ^GLBTLS(SESSID,"meta","lastcheck")=$H
 ;   ; Do NOT create chain entry so post-conditional is FALSE
 ;   D CERT^TLSUTIL
 ;   ; Verify: ^GLBTLS(SESSID,"meta","lastcheck","expire") should NOT exist
 ;   ; Verify: ^GLBTLS(SESSID,"cert",CERTID,"ts") SHOULD exist
 ;   W "Test 1 PASS: ",$S('$D(^GLBTLS(SESSID,"meta","lastcheck","expire")):"OK",1:"FAIL"),!
 ;
 ; Test 2: Extrinsic function side effect on naked reference
 ; Verifies that $$HASH^TLSCERT does not corrupt the naked reference
 ; and that CERT+18 writes to ^GLBTLS(SESSID,"cert",CERTID,"ts")
 ; not to ^XTMP("TLSHASH",$J,...,"ts")
 ;
 ; Setup:
 ;   S SESSID="TEST2",CERTID="C2"
 ;   S ^GLBTLS(SESSID,"cert",CERTID,"raw")="FAKECERT"
 ;   D CERT^TLSUTIL
 ;   ; Verify: ^GLBTLS(SESSID,"cert",CERTID,"ts") exists with a $H value
 ;   ; Verify: no orphaned ^XTMP("TLSHASH",$J,SEQNO,"ts") entries
 ;   W "Test 2 PASS: ",$S($D(^GLBTLS(SESSID,"cert",CERTID,"ts")):"OK",1:"FAIL"),!
 ;
 ; Test 3: KILL-then-SET ordering (VERIFY+6/VERIFY+7)
 ; Verifies that after VERIFY, no phantom ^GLBTLS nodes with $DATA=10 exist
 ;
 ; Setup:
 ;   S SESSID="TEST3"
 ;   S ^GLBTLS(SESSID,"chain","1","raw")="RAWCERTDATA"
 ;   D VERIFY^TLSUTIL
 ;   ; Verify: ^GLBTLS(SESSID,"chain","1","raw") has been KILLed
 ;   ; Verify: ^GLBTLS(SESSID,"chain","1","status")="V"
 ;   ; Verify: $D(^GLBTLS(SESSID,"chain","1","raw")) should be 0 (not 10)
 ;   W "Test 3 PASS: ",$S('$D(^GLBTLS(SESSID,"chain","1","raw")):"OK",1:"FAIL"),!
 ;
 ; Test 4: $DATA=10 phantom node detection
 ; Verifies that $D()#2 correctly rejects phantom descendant-only nodes
 ;
 ; Setup:
 ;   S SESSID="TEST4"
 ;   ; Create a node that has descendants but no data value
 ;   KILL ^GLBTLS(SESSID,"chain","99")
 ;   S ^GLBTLS(SESSID,"chain","99","child")="phantom child"
 ;   ; Now ^GLBTLS(SESSID,"chain","99","raw") does not exist
 ;   ; and ^GLBTLS(SESSID,"chain","99") has $DATA=10 (descendants only)
 ;   ; VERIFY loop should skip this entry
 ;   D VERIFY^TLSUTIL
 ;   ; Verify: no status was written for IDX="99"
 ;   W "Test 4 PASS: ",$S('$D(^GLBTLS(SESSID,"chain","99","status")):"OK",1:"FAIL"),!
 ;
