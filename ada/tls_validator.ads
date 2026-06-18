--  tls_validator.ads - TLS Certificate Chain Validator (spec)
--  Copyright (c) 2024 SecureNet Systems

with Ada.Strings.Unbounded;

--  =========================================================================
--  TLS peer certificate chain validation.
--
--  A peer-presented chain is handed to the validator through the
--  Cert_Chain_Ptr access type (allocated by the transport layer).
--  Verify_Peer_Identity owns that storage and releases it before returning,
--  setting the access value to null so callers cannot dereference freed
--  memory afterwards.
--  =========================================================================
package TLS_Validator is

   use Ada.Strings.Unbounded;

   --  Maximum number of certificates accepted in a single chain.
   Max_Chain_Depth : constant := 16;

   type Verify_Status is
     (Cert_Status_Ok,           --  chain is valid and host name matches
      Cert_Status_Expired,      --  a certificate is outside its validity window
      Cert_Status_Invalid,      --  malformed chain / broken issuer linkage
      Cert_Status_Untrusted,    --  root is not a CA / host name mismatch
      Cert_Status_Empty_Chain); --  no certificates were presented

   --  Public-key algorithm carried by a certificate's SubjectPublicKeyInfo.
   type Key_Algorithm_Kind is (RSA_2048, RSA_4096, EC_P256, EC_P384);

   --  A single certificate in a peer-presented chain. The public-key
   --  parameters differ per algorithm, so the record is discriminated by
   --  Key_Algorithm. The discriminant DEFAULTS to RSA_2048: that default is
   --  what makes standalone objects and array components mutable, so the
   --  algorithm can be reassigned in place once the SubjectPublicKeyInfo has
   --  been decoded (see TLS_Validator body, Parse_SubjectPublicKeyInfo).
   type Certificate_Record
     (Key_Algorithm : Key_Algorithm_Kind := RSA_2048) is
   record
      Subject       : Unbounded_String;
      Issuer        : Unbounded_String;
      Algorithm_Oid : Unbounded_String;  --  SubjectPublicKeyInfo algorithm OID
      Not_Before    : Long_Integer := 0; --  unix seconds, inclusive
      Not_After     : Long_Integer := 0; --  unix seconds, inclusive
      Is_CA         : Boolean := False;
      case Key_Algorithm is
         when RSA_2048 | RSA_4096 =>
            Modulus_Bits : Natural := 0;
         when EC_P256 | EC_P384 =>
            Curve_Name : Unbounded_String;
      end case;
   end record;

   type Certificate_Array is array (Positive range <>) of Certificate_Record;

   --  Heap-allocated certificate chain, leaf first, root last.
   type Cert_Chain_Ptr is access Certificate_Array;

   --  Outcome of verifying a peer's certificate chain.
   type Identity_Result is record
      Status   : Verify_Status := Cert_Status_Invalid;
      Identity : Unbounded_String := Null_Unbounded_String;
      --  ^ subject of the leaf certificate when Status = Cert_Status_Ok
   end record;

   --  Verify the peer's certificate chain against the expected host name and
   --  the supplied wall-clock time (unix seconds).
   --
   --  Chain is released by this routine and set to null on return, so callers
   --  cannot dereference freed storage afterwards. A null or empty chain is
   --  handled gracefully (Cert_Status_Empty_Chain) rather than crashing.
   procedure Verify_Peer_Identity
     (Chain         : in out Cert_Chain_Ptr;
      Expected_Host : String;
      Now           : Long_Integer;
      Result        : out Identity_Result);

   --  Release a certificate chain and set the access value to null. Safe to
   --  call on a null chain and safe to call more than once on the same
   --  variable (the second call is a no-op).
   procedure Free_Chain (Chain : in out Cert_Chain_Ptr);

end TLS_Validator;
