--  test_tls_validator.adb - regression tests for TLS_Validator
--  Copyright (c) 2024 SecureNet Systems
--
--  Build & run (GNAT):
--     gnatmake test_tls_validator.adb
--     ./test_tls_validator        --  exit status 0 on success, 1 on failure
--
--  The central regression exercises the exact path that crashed on the
--  unfixed validator: an EC P-384 leaf drives Parse_SubjectPublicKeyInfo to
--  reassign the Certificate_Record discriminant to EC_P384 and then runs
--  Verify_Certificate_Signature on that EC certificate. On the unfixed code
--  the discriminant reassignment / the unconditional read of Modulus_Bits on
--  an EC cert raised Constraint_Error, and the Constraint_Error handler then
--  freed the chain a second time (double free). With the fix the chain
--  verifies cleanly and is released exactly once.

with Ada.Text_IO;           use Ada.Text_IO;
with Ada.Command_Line;      use Ada.Command_Line;
with Ada.Strings.Unbounded; use Ada.Strings.Unbounded;
with TLS_Validator;         use TLS_Validator;

procedure Test_TLS_Validator is

   Failures : Natural := 0;

   procedure Check (Name : String; Condition : Boolean) is
   begin
      if Condition then
         Put_Line ("ok   - " & Name);
      else
         Put_Line ("FAIL - " & Name);
         Failures := Failures + 1;
      end if;
   end Check;

   Now : constant Long_Integer := 1_700_000_000;

   --  A two-certificate chain: an EC P-384 leaf issued by an RSA root CA.
   --  The leaf is constructed in the DEFAULT RSA_2048 variant but advertises
   --  the secp384r1 OID, so Parse_SubjectPublicKeyInfo must reshape it into
   --  the EC_P384 variant during verification.
   function Make_EC_Leaf_Chain return Cert_Chain_Ptr is
      Leaf : constant Certificate_Record :=
        (Key_Algorithm => RSA_2048,
         Subject       => To_Unbounded_String ("CN=example.com"),
         Issuer        => To_Unbounded_String ("CN=Root CA"),
         Algorithm_Oid => To_Unbounded_String ("1.3.132.0.34"),  --  P-384
         Not_Before    => Now - 1_000,
         Not_After     => Now + 1_000,
         Is_CA         => False,
         Modulus_Bits  => 0);
      Root : constant Certificate_Record :=
        (Key_Algorithm => RSA_2048,
         Subject       => To_Unbounded_String ("CN=Root CA"),
         Issuer        => To_Unbounded_String ("CN=Root CA"),
         Algorithm_Oid => To_Unbounded_String ("1.2.840.113549.1.1.1"),  --  RSA
         Not_Before    => Now - 1_000,
         Not_After     => Now + 1_000,
         Is_CA         => True,
         Modulus_Bits  => 2048);
   begin
      return new Certificate_Array'(1 => Leaf, 2 => Root);
   end Make_EC_Leaf_Chain;

   Chain  : Cert_Chain_Ptr;
   Result : Identity_Result;

begin
   -----------------------------------------------------------------------
   --  Regression: EC P-384 leaf must verify without Constraint_Error and
   --  without a double free.
   -----------------------------------------------------------------------
   Chain := Make_EC_Leaf_Chain;
   Verify_Peer_Identity (Chain, "example.com", Now, Result);

   Check ("EC P-384 chain verifies without Constraint_Error",
          Result.Status = Cert_Status_Ok);
   Check ("leaf identity reported",
          Result.Identity = To_Unbounded_String ("CN=example.com"));
   Check ("chain released and pointer nulled on success",
          Chain = null);

   --  The release must be idempotent: calling Free_Chain again on the
   --  already-released variable is the guard that prevents the historic
   --  double free.
   Free_Chain (Chain);
   Check ("Free_Chain is a no-op after release", Chain = null);

   -----------------------------------------------------------------------
   --  Edge cases.
   -----------------------------------------------------------------------

   --  Null chain: handled gracefully, never dereferenced.
   Chain := null;
   Verify_Peer_Identity (Chain, "example.com", Now, Result);
   Check ("null chain -> empty-chain status",
          Result.Status = Cert_Status_Empty_Chain);

   --  Empty chain (length 0): same graceful handling.
   Chain := new Certificate_Array (1 .. 0);
   Verify_Peer_Identity (Chain, "example.com", Now, Result);
   Check ("empty chain -> empty-chain status",
          Result.Status = Cert_Status_Empty_Chain);
   Check ("empty chain released", Chain = null);

   --  Host-name mismatch on an otherwise valid EC chain -> untrusted.
   Chain := Make_EC_Leaf_Chain;
   Verify_Peer_Identity (Chain, "attacker.example", Now, Result);
   Check ("host mismatch -> untrusted", Result.Status = Cert_Status_Untrusted);
   Check ("chain released on host mismatch", Chain = null);

   --  Expired leaf -> expired (Now far beyond Not_After).
   Chain := Make_EC_Leaf_Chain;
   Verify_Peer_Identity (Chain, "example.com", Now + 10_000, Result);
   Check ("expired chain -> expired", Result.Status = Cert_Status_Expired);
   Check ("chain released on expiry", Chain = null);

   -----------------------------------------------------------------------
   --  Verdict.
   -----------------------------------------------------------------------
   if Failures = 0 then
      Put_Line ("All TLS_Validator regression checks passed.");
      Set_Exit_Status (Success);
   else
      Put_Line
        ("TLS_Validator regression FAILED:" & Natural'Image (Failures)
         & " check(s).");
      Set_Exit_Status (Failure);
   end if;
end Test_TLS_Validator;
