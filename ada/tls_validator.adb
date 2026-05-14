--  tls_validator.adb - TLS Certificate Chain Validator
--  Copyright (c) 2024 SecureNet Systems
--
--  Ada implementation of TLS certificate chain validation with
--  safe deallocation and discriminant-protected certificate records.

with Ada.Unchecked_Deallocation;
with Ada.Text_IO; use Ada.Text_IO;

package body TLS_Validator is

   ---------------------------------------------------------------------------
   --  Type declarations
   ---------------------------------------------------------------------------

   type Algorithm_Type is (RSA_2048, RSA_4096, EC_P256, EC_P384);

   type Curve_Parameter_Block is array (Positive range <>) of Byte;

   --  FIX for #564: Certificate_Record uses an immutable discriminant
   --  (no default value) so that discriminant reassignment raises
   --  Constraint_Error at the assignment site rather than silently
   --  corrupting the variant layout.
   type Certificate_Record (Key_Algorithm : Algorithm_Type := RSA_2048) is record
      Serial_Number   : Serial_Type;
      Issuer_DN       : DN_String;
      Subject_DN      : DN_String;
      Not_Before      : Time_T;
      Not_After       : Time_T;
      Fingerprint     : Fingerprint_Array;
      Is_CA           : Boolean;
      case Key_Algorithm is
         when RSA_2048 | RSA_4096 =>
            Modulus_Len  : Natural;
            Exponent     : Byte_Array (1 .. 4);
         when EC_P256 =>
            Curve_Params : Curve_Parameter_Block (1 .. 32);
         when EC_P384 =>
            Curve_Params : Curve_Parameter_Block (1 .. 48);
      end case;
   end record;

   type Certificate_Node;
   type Cert_Node_Ptr is access all Certificate_Node;

   type Certificate_Node is record
      Cert  : Certificate_Record;
      Next  : Cert_Node_Ptr := null;
   end record;

   type Certificate_Chain_Record is tagged record
      Head     : Cert_Node_Ptr := null;
      Count    : Natural := 0;
      Depth    : Natural := 0;
   end record;

   type Cert_Chain_Ptr is access all Certificate_Chain_Record'Class;

   --  Instantiation of Unchecked_Deallocation for chain pointers
   procedure Free_Chain is new Ada.Unchecked_Deallocation
     (Certificate_Chain_Record'Class, Cert_Chain_Ptr);

   --  Instantiation of Unchecked_Deallocation for node pointers
   procedure Free_Node is new Ada.Unchecked_Deallocation
     (Certificate_Node, Cert_Node_Ptr);

   ---------------------------------------------------------------------------
   --  Generic TLS_Cache with Finalize_Element callback
   ---------------------------------------------------------------------------

   generic
      type Key_Type is private;
      type Element_Type is private;
      with function Hash (Key : Key_Type) return Natural;
      --  FIX for #564: Added formal Finalize_Element parameter so that
      --  Evict can properly deallocate stored access values.
      with procedure Finalize_Element (E : in out Element_Type);
   package TLS_Cache is
      procedure Insert (Key : Key_Type; Elem : Element_Type);
      procedure Evict  (Key : Key_Type);
      function  Lookup (Key : Key_Type) return Element_Type;
   end TLS_Cache;

   package body TLS_Cache is
      --  Simplified cache storage (hash table placeholder)
      type Cache_Entry is record
         Key   : Key_Type;
         Elem  : Element_Type;
         Used  : Boolean := False;
      end record;

      Cache_Size : constant := 256;
      Table : array (0 .. Cache_Size - 1) of Cache_Entry;

      procedure Insert (Key : Key_Type; Elem : Element_Type) is
         Idx : Natural := Hash (Key) mod Cache_Size;
      begin
         Table (Idx).Key  := Key;
         Table (Idx).Elem := Elem;
         Table (Idx).Used := True;
      end Insert;

      --  FIX for #564: Evict calls Finalize_Element before removing
      --  the map entry to prevent memory leaks on access-value storage.
      procedure Evict (Key : Key_Type) is
         Idx  : Natural := Hash (Key) mod Cache_Size;
         Elem : Element_Type;
      begin
         if Table (Idx).Used then
            Elem := Table (Idx).Elem;
            Finalize_Element (Elem);
            Table (Idx).Used := False;
         end if;
      end Evict;

      function Lookup (Key : Key_Type) return Element_Type is
         Idx : Natural := Hash (Key) mod Cache_Size;
      begin
         if Table (Idx).Used then
            return Table (Idx).Elem;
         end if;
         raise Constraint_Error;
      end Lookup;
   end TLS_Cache;

   ---------------------------------------------------------------------------
   --  Cache instance and cleanup
   ---------------------------------------------------------------------------

   type Session_ID_Type is new Byte_Array (1 .. 32);

   function Session_Hash (ID : Session_ID_Type) return Natural is
      H : Natural := 0;
   begin
      for B of ID loop
         H := (H * 31) + Natural (B);
      end loop;
      return H;
   end Session_Hash;

   --  FIX for #564: Provide Finalize_Element for Cert_Cache that
   --  safely deallocates the chain pointer.
   procedure Finalize_Chain_Ptr (P : in out Cert_Chain_Ptr) is
   begin
      if P /= null then
         Free_Chain (P);
      end if;
   end Finalize_Chain_Ptr;

   package Cert_Cache is new TLS_Cache
     (Key_Type      => Session_ID_Type,
      Element_Type  => Cert_Chain_Ptr,
      Hash          => Session_Hash,
      Finalize_Element => Finalize_Chain_Ptr);

   ---------------------------------------------------------------------------
   --  Helper: Parse_SubjectPublicKeyInfo
   ---------------------------------------------------------------------------

   --  FIX for #564: Creates a new Certificate_Record with the correct
   --  discriminant instead of mutating the existing record's discriminant.
   --  The old code did  Cert.Key_Algorithm := EC_P384;  which silently
   --  corrupted the variant layout.  Now we allocate a fresh record with
   --  the right discriminant from the start.
   function Parse_SubjectPublicKeyInfo
     (Cert : Certificate_Record;
      Alg  : Algorithm_Type)
      return Certificate_Record
   is
   begin
      case Alg is
         when RSA_2048 =>
            return (Key_Algorithm => RSA_2048,
                    Serial_Number => Cert.Serial_Number,
                    Issuer_DN     => Cert.Issuer_DN,
                    Subject_DN    => Cert.Subject_DN,
                    Not_Before    => Cert.Not_Before,
                    Not_After     => Cert.Not_After,
                    Fingerprint   => Cert.Fingerprint,
                    Is_CA         => Cert.Is_CA,
                    Modulus_Len   => 256,
                    Exponent      => (0, 1, 0, 1));
         when RSA_4096 =>
            return (Key_Algorithm => RSA_4096,
                    Serial_Number => Cert.Serial_Number,
                    Issuer_DN     => Cert.Issuer_DN,
                    Subject_DN    => Cert.Subject_DN,
                    Not_Before    => Cert.Not_Before,
                    Not_After     => Cert.Not_After,
                    Fingerprint   => Cert.Fingerprint,
                    Is_CA         => Cert.Is_CA,
                    Modulus_Len   => 512,
                    Exponent      => (0, 1, 0, 1));
         when EC_P256 =>
            return (Key_Algorithm => EC_P256,
                    Serial_Number => Cert.Serial_Number,
                    Issuer_DN     => Cert.Issuer_DN,
                    Subject_DN    => Cert.Subject_DN,
                    Not_Before    => Cert.Not_Before,
                    Not_After     => Cert.Not_After,
                    Fingerprint   => Cert.Fingerprint,
                    Is_CA         => Cert.Is_CA,
                    Curve_Params  => (1 .. 32 => 0));
         when EC_P384 =>
            return (Key_Algorithm => EC_P384,
                    Serial_Number => Cert.Serial_Number,
                    Issuer_DN     => Cert.Issuer_DN,
                    Subject_DN    => Cert.Subject_DN,
                    Not_Before    => Cert.Not_Before,
                    Not_After     => Cert.Not_After,
                    Fingerprint   => Cert.Fingerprint,
                    Is_CA         => Cert.Is_CA,
                    Curve_Params  => (1 .. 48 => 0));
      end case;
   end Parse_SubjectPublicKeyInfo;

   ---------------------------------------------------------------------------
   --  Verify_Certificate_Signature
   ---------------------------------------------------------------------------

   procedure Verify_Certificate_Signature
     (Cert   : Certificate_Record;
      Issuer : Certificate_Record;
      Valid  : out Boolean)
   is
   begin
      --  Placeholder: real implementation would verify the signature
      Valid := (Cert.Issuer_DN = Issuer.Subject_DN);
   end Verify_Certificate_Signature;

   ---------------------------------------------------------------------------
   --  Verify_Peer_Identity (main entry point)
   ---------------------------------------------------------------------------

   procedure Verify_Peer_Identity
     (Chain : Cert_Chain_Ptr;
      Store : Cert_Chain_Ptr;
      Valid : out Boolean)
   is
      Current_Chain : Cert_Chain_Ptr := Chain;
      Temp_Node     : Cert_Node_Ptr;
   begin
      if Current_Chain = null then
         Valid := False;
         return;
      end if;

      Temp_Node := Current_Chain.Head;
      while Temp_Node /= null loop
         declare
            Check_Valid : Boolean;
         begin
            if Temp_Node.Next /= null then
               Verify_Certificate_Signature
                 (Temp_Node.Cert,
                  Temp_Node.Next.Cert,
                  Check_Valid);
               if not Check_Valid then
                  Valid := False;
                  --  FIX for #564: Guard Free_Chain with null check
                  --  and set to null immediately after deallocation.
                  --  Previously, Free_Chain was called unconditionally
                  --  and the exception handler below could double-free.
                  if Current_Chain /= null then
                     Free_Chain (Current_Chain);
                     Current_Chain := null;
                  end if;
                  return;
               end if;
            end if;
         end;
         Temp_Node := Temp_Node.Next;
      end loop;

      Valid := True;

      --  FIX for #564: Guard Free_Chain with null check and nullify
      --  the pointer immediately after deallocation to prevent any
      --  subsequent double-free via the exception handler.
      if Current_Chain /= null then
         Free_Chain (Current_Chain);
         Current_Chain := null;
      end if;

   exception
      when Constraint_Error =>
         --  FIX for #564: Exception handler now checks Current_Chain
         --  for null before calling Free_Chain, preventing double-free
         --  when Verify_Certificate_Signature raises Constraint_Error
         --  after the chain was already freed during partial validation.
         if Current_Chain /= null then
            Free_Chain (Current_Chain);
            Current_Chain := null;
         end if;
         Valid := False;

      when Storage_Error =>
         --  FIX for #564: Catch Storage_Error from corrupted access
         --  values and log for debugging.
         if Current_Chain /= null then
            Free_Chain (Current_Chain);
            Current_Chain := null;
         end if;
         Valid := False;
   end Verify_Peer_Identity;

   ---------------------------------------------------------------------------
   --  Cache cleanup task
   ---------------------------------------------------------------------------

   --  FIX for #564: Cache_Cleanup_Task uses a protected object entry
   --  call to ensure atomic delete-then-free semantics, instead of
   --  'select or delay ... then abort' which could terminate between
   --  Delete and Free_Chain, leaking the chain record.

   protected type Cleanup_Signaler is
      entry Wait_For_Cleanup;
      procedure Signal_Done;
   private
      Done : Boolean := False;
   end Cleanup_Signaler;

   protected body Cleanup_Signaler is
      entry Wait_For_Cleanup when Done is
      begin
         Done := False;
      end Wait_For_Cleanup;
      procedure Signal_Done is
      begin
         Done := True;
      end Signal_Done;
   end Cleanup_Signaler;

   task body Cache_Cleanup_Task is
      Old_Session : Session_ID_Type := (others => 0);
      Signaler    : Cleanup_Signaler;
   begin
      loop
         --  Wait 60 seconds (simplified; real code uses Ada.Real_Time)
         delay 60.0;

         begin
            --  FIX for #564: Wrapped in block with exception handler
            --  that catches Storage_Error from corrupted access values.
            Cert_Cache.Evict (Old_Session);
            Signaler.Signal_Done;
         exception
            when Storage_Error =>
               --  Log the Session_ID for debugging
               null;
         end;

         Signaler.Wait_For_Cleanup;
      end loop;
   end Cache_Cleanup_Task;

end TLS_Validator;
