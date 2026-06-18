--  tls_validator.adb - TLS Certificate Chain Validator (body)
--  Copyright (c) 2024 SecureNet Systems

with Ada.Unchecked_Deallocation;

package body TLS_Validator is

   --  Reclaims the storage designated by a Cert_Chain_Ptr. The instantiated
   --  Deallocate sets its actual parameter to null on return (Ada RM 13.11.2),
   --  which is what makes Free_Chain idempotent and prevents a later access
   --  from touching freed storage.
   procedure Deallocate is new Ada.Unchecked_Deallocation
     (Object => Certificate_Array,
      Name   => Cert_Chain_Ptr);

   ----------------
   -- Free_Chain --
   ----------------

   procedure Free_Chain (Chain : in out Cert_Chain_Ptr) is
   begin
      if Chain /= null then
         Deallocate (Chain);  --  also nulls Chain
      end if;
   end Free_Chain;

   -- ----------------------------------------------------------------------
   -- Internal helpers
   -- ----------------------------------------------------------------------

   --  Map a SubjectPublicKeyInfo algorithm OID onto a Key_Algorithm_Kind.
   --  Unknown OIDs fall back to RSA_2048.
   function Algorithm_Of_Oid (Oid : Unbounded_String) return Key_Algorithm_Kind
   is
      S : constant String := To_String (Oid);
   begin
      if S = "1.2.840.10045.3.1.7" then        --  prime256v1  (NIST P-256)
         return EC_P256;
      elsif S = "1.3.132.0.34" then            --  secp384r1   (NIST P-384)
         return EC_P384;
      else                                     --  rsaEncryption and unknown
         return RSA_2048;
      end if;
   end Algorithm_Of_Oid;

   --  Decode a certificate's SubjectPublicKeyInfo and bring its discriminant
   --  into agreement with the algorithm advertised on the wire. When the
   --  decoded algorithm differs from the record's current Key_Algorithm (for
   --  example an EC P-384 key carried on a certificate that defaulted to
   --  RSA_2048), the discriminant is changed by a WHOLE-RECORD assignment.
   --
   --  That assignment only succeeds when Cert is mutable, i.e. an
   --  unconstrained object of a default-discriminant type. Cert is therefore
   --  taken as an "in out" of the unconstrained type and the caller passes a
   --  mutable chain element directly -- it is NOT copied into a temporary
   --  constrained by its current discriminant, which is what previously
   --  raised Constraint_Error when reassigning to EC_P384.
   procedure Parse_SubjectPublicKeyInfo (Cert : in out Certificate_Record) is
      Detected : constant Key_Algorithm_Kind :=
        Algorithm_Of_Oid (Cert.Algorithm_Oid);
   begin
      if Cert.Key_Algorithm = Detected then
         return;  --  already in the right variant; nothing to reshape
      end if;

      case Detected is
         when RSA_2048 | RSA_4096 =>
            Cert :=
              (Key_Algorithm => Detected,
               Subject       => Cert.Subject,
               Issuer        => Cert.Issuer,
               Algorithm_Oid => Cert.Algorithm_Oid,
               Not_Before    => Cert.Not_Before,
               Not_After     => Cert.Not_After,
               Is_CA         => Cert.Is_CA,
               Modulus_Bits  => (if Detected = RSA_4096 then 4096 else 2048));
         when EC_P256 | EC_P384 =>
            Cert :=
              (Key_Algorithm => Detected,
               Subject       => Cert.Subject,
               Issuer        => Cert.Issuer,
               Algorithm_Oid => Cert.Algorithm_Oid,
               Not_Before    => Cert.Not_Before,
               Not_After     => Cert.Not_After,
               Is_CA         => Cert.Is_CA,
               Curve_Name    =>
                 To_Unbounded_String
                   ((if Detected = EC_P384 then "P-384" else "P-256")));
      end case;
   end Parse_SubjectPublicKeyInfo;

   --  True when Now falls within [Not_Before, Not_After].
   function Is_Within_Validity
     (Cert : Certificate_Record; Now : Long_Integer) return Boolean
   is
   begin
      return Now >= Cert.Not_Before and then Now <= Cert.Not_After;
   end Is_Within_Validity;

   --  True when Issuer issued Subject, i.e. the subject's Issuer field names
   --  the issuer's Subject.
   function Issued_By (Subject, Issuer : Certificate_Record) return Boolean is
   begin
      return Subject.Issuer = Issuer.Subject;
   end Issued_By;

   --  Confirm that Cert was signed by Issuer. The strength parameter lives in
   --  a different variant component per algorithm, so it MUST be selected
   --  under a case on Key_Algorithm: reading Cert.Modulus_Bits on an EC
   --  certificate (or Cert.Curve_Name on an RSA one) would reference a
   --  component absent from that variant and raise Constraint_Error.
   function Verify_Certificate_Signature
     (Cert : Certificate_Record; Issuer : Certificate_Record) return Boolean
   is
   begin
      if Cert.Issuer /= Issuer.Subject then
         return False;
      end if;

      case Cert.Key_Algorithm is
         when RSA_2048 | RSA_4096 =>
            return Cert.Modulus_Bits >= 2048;
         when EC_P256 | EC_P384 =>
            return Length (Cert.Curve_Name) > 0;
      end case;
   end Verify_Certificate_Signature;

   --  True when the host appears in the leaf subject (e.g. "CN=example.com").
   function Host_Matches
     (Subject : Unbounded_String; Host : String) return Boolean
   is
   begin
      if Host'Length = 0 then
         return False;
      end if;
      return Index (Subject, Host) /= 0;
   end Host_Matches;

   --------------------------
   -- Verify_Peer_Identity --
   --------------------------

   procedure Verify_Peer_Identity
     (Chain         : in out Cert_Chain_Ptr;
      Expected_Host : String;
      Now           : Long_Integer;
      Result        : out Identity_Result)
   is
      --  Single owner of the chain storage. All release sites below go
      --  through Free_Chain (Current_Chain); because Free_Chain nulls its
      --  argument, there is exactly one underlying pointer and it can be
      --  freed at most once.
      Current_Chain : Cert_Chain_Ptr renames Chain;
   begin
      Result := (Status   => Cert_Status_Invalid,
                 Identity => Null_Unbounded_String);

      --  Edge case: no chain presented. Never dereference a null access.
      if Current_Chain = null or else Current_Chain'Length = 0 then
         Result.Status := Cert_Status_Empty_Chain;
         Free_Chain (Current_Chain);  --  no-op on null; keeps post-condition
         return;
      end if;

      --  Edge case: implausibly long chain.
      if Current_Chain'Length > Max_Chain_Depth then
         Result.Status := Cert_Status_Invalid;
         Free_Chain (Current_Chain);
         return;
      end if;

      --  Capture the leaf identity up front, before the chain is released, so
      --  the success path never reads through the access value after freeing.
      Result.Identity := Current_Chain (Current_Chain'First).Subject;

      for I in Current_Chain'Range loop
         --  Bring each certificate's discriminant in line with its decoded
         --  public-key algorithm. An EC P-384 leaf is reshaped here.
         Parse_SubjectPublicKeyInfo (Current_Chain (I));

         if not Is_Within_Validity (Current_Chain (I), Now) then
            Result.Status   := Cert_Status_Expired;
            Result.Identity := Null_Unbounded_String;
            Free_Chain (Current_Chain);  --  partial-validation cleanup
            return;
         end if;

         if I < Current_Chain'Last then
            if not Issued_By (Current_Chain (I), Current_Chain (I + 1)) then
               Result.Status   := Cert_Status_Invalid;
               Result.Identity := Null_Unbounded_String;
               Free_Chain (Current_Chain);  --  partial-validation cleanup
               return;
            end if;

            if not Verify_Certificate_Signature
                     (Current_Chain (I), Current_Chain (I + 1))
            then
               Result.Status   := Cert_Status_Invalid;
               Result.Identity := Null_Unbounded_String;
               Free_Chain (Current_Chain);  --  partial-validation cleanup
               return;
            end if;
         end if;
      end loop;

      --  The terminal certificate must be a CA to anchor the chain.
      if not Current_Chain (Current_Chain'Last).Is_CA then
         Result.Status   := Cert_Status_Untrusted;
         Result.Identity := Null_Unbounded_String;
         Free_Chain (Current_Chain);
         return;
      end if;

      --  Finally bind the leaf to the host name the caller expected.
      if not Host_Matches
               (Current_Chain (Current_Chain'First).Subject, Expected_Host)
      then
         Result.Status   := Cert_Status_Untrusted;
         Result.Identity := Null_Unbounded_String;
         Free_Chain (Current_Chain);
         return;
      end if;

      Result.Status := Cert_Status_Ok;

      --  Release the chain exactly once, after every field we need has been
      --  copied out.
      Free_Chain (Current_Chain);

   exception
      when Constraint_Error =>
         --  A parsing or validation step raised Constraint_Error. A
         --  partial-validation cleanup above may already have released the
         --  chain, so this handler MUST NOT free it unconditionally. The
         --  guard makes the release idempotent: Free_Chain nulled
         --  Current_Chain when the cleanup path ran, so the call below is a
         --  no-op in that case and the historic double free cannot recur.
         if Current_Chain /= null then
            Free_Chain (Current_Chain);
         end if;
         Result := (Status   => Cert_Status_Invalid,
                    Identity => Null_Unbounded_String);
   end Verify_Peer_Identity;

end TLS_Validator;
