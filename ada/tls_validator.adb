with Ada.Exceptions;
with Ada.Strings.Unbounded;
with Ada.Text_IO;
with Ada.Unchecked_Deallocation;

package body TLS_Validator is
   use Ada.Strings.Unbounded;

   type Algorithm_Type is (RSA_2048, RSA_4096, EC_P256, EC_P384);

   type Curve_Parameter_Block is array (Positive range <>) of Interfaces.Unsigned_8;

   type Certificate_Record (Key_Algorithm : Algorithm_Type) is record
      Subject_DN : Unbounded_String;
      Issuer_DN : Unbounded_String;
      Serial : Unbounded_String;
      case Key_Algorithm is
         when RSA_2048 =>
            Rsa_2048_Modulus : Unbounded_String;
         when RSA_4096 =>
            Rsa_4096_Modulus : Unbounded_String;
         when EC_P256 =>
            Curve_Params_256 : Curve_Parameter_Block (1 .. 32);
         when EC_P384 =>
            Curve_Params_384 : Curve_Parameter_Block (1 .. 48);
      end case;
   end record;

   type Certificate_Chain_Record is tagged record
      Leaf : Certificate_Record (RSA_2048);
      Next : access Certificate_Chain_Record'Class;
   end record;

   type Cert_Chain_Ptr is access all Certificate_Chain_Record'Class;

   procedure Free_Chain_Raw is new Ada.Unchecked_Deallocation
     (Object => Certificate_Chain_Record'Class,
      Name   => Cert_Chain_Ptr);

   procedure Safe_Free_Chain (Current_Chain : in out Cert_Chain_Ptr) is
   begin
      if Current_Chain /= null then
         Free_Chain_Raw (Current_Chain);
         Current_Chain := null;
      end if;
   end Safe_Free_Chain;

   procedure Verify_Certificate_Signature (Chain : Cert_Chain_Ptr) is
   begin
      if Chain = null then
         raise Constraint_Error with "missing chain";
      end if;
   end Verify_Certificate_Signature;

   function Parse_SubjectPublicKeyInfo
     (Algorithm : Algorithm_Type;
      Raw_Curve : Curve_Parameter_Block) return Certificate_Record
   is
   begin
      case Algorithm is
         when RSA_2048 =>
            return Certificate_Record'
              (Key_Algorithm    => RSA_2048,
               Subject_DN       => Null_Unbounded_String,
               Issuer_DN        => Null_Unbounded_String,
               Serial           => Null_Unbounded_String,
               Rsa_2048_Modulus => Null_Unbounded_String);
         when RSA_4096 =>
            return Certificate_Record'
              (Key_Algorithm    => RSA_4096,
               Subject_DN       => Null_Unbounded_String,
               Issuer_DN        => Null_Unbounded_String,
               Serial           => Null_Unbounded_String,
               Rsa_4096_Modulus => Null_Unbounded_String);
         when EC_P256 =>
            return Certificate_Record'
              (Key_Algorithm    => EC_P256,
               Subject_DN       => Null_Unbounded_String,
               Issuer_DN        => Null_Unbounded_String,
               Serial           => Null_Unbounded_String,
               Curve_Params_256 => Raw_Curve (1 .. 32));
         when EC_P384 =>
            return Certificate_Record'
              (Key_Algorithm    => EC_P384,
               Subject_DN       => Null_Unbounded_String,
               Issuer_DN        => Null_Unbounded_String,
               Serial           => Null_Unbounded_String,
               Curve_Params_384 => Raw_Curve (1 .. 48));
      end case;
   end Parse_SubjectPublicKeyInfo;

   generic
      type Key_Type is private;
      type Element_Type is private;
      with function Hash (Key : Key_Type) return Natural;
      with procedure Finalize_Element (E : in out Element_Type);
   package TLS_Cache is
      procedure Insert (Key : Key_Type; Element : Element_Type);
      procedure Evict (Key : Key_Type);
   end TLS_Cache;

   package body TLS_Cache is
      Cache_Size : constant Natural := 256;

      type Entry_Record is record
         Key : Key_Type;
         Element : Element_Type;
         Present : Boolean := False;
      end record;

      Cache : array (Natural range 0 .. Cache_Size - 1) of Entry_Record;

      procedure Insert (Key : Key_Type; Element : Element_Type) is
         Index : constant Natural := Hash (Key) mod Cache_Size;
      begin
         if Cache (Index).Present then
            Finalize_Element (Cache (Index).Element);
         end if;
         Cache (Index).Key := Key;
         Cache (Index).Element := Element;
         Cache (Index).Present := True;
      end Insert;

      procedure Evict (Key : Key_Type) is
         Index : constant Natural := Hash (Key) mod Cache_Size;
      begin
         if Cache (Index).Present then
            Finalize_Element (Cache (Index).Element);
            Cache (Index).Present := False;
         end if;
      end Evict;
   end TLS_Cache;

   procedure Finalize_Chain (Chain : in out Cert_Chain_Ptr) is
   begin
      Safe_Free_Chain (Chain);
   end Finalize_Chain;

   function Session_Hash (Session_ID : Natural) return Natural is (Session_ID);

   package Cert_Cache is new TLS_Cache
     (Key_Type         => Natural,
      Element_Type     => Cert_Chain_Ptr,
      Hash             => Session_Hash,
      Finalize_Element => Finalize_Chain);

   protected Cleanup_Guard is
      procedure Atomic_Evict (Session_ID : Natural);
   end Cleanup_Guard;

   protected body Cleanup_Guard is
      procedure Atomic_Evict (Session_ID : Natural) is
      begin
         Cert_Cache.Evict (Session_ID);
      end Atomic_Evict;
   end Cleanup_Guard;

   task body Cache_Cleanup_Task is
      Session_ID : Natural := 0;
   begin
      loop
         select
            delay 60.0;
            begin
               Cleanup_Guard.Atomic_Evict (Session_ID);
            exception
               when Storage_Error =>
                  Ada.Text_IO.Put_Line
                    ("Storage_Error while cleaning session "
                     & Natural'Image (Session_ID));
               when E : others =>
                  Ada.Text_IO.Put_Line
                    ("Cleanup error for session "
                     & Natural'Image (Session_ID)
                     & ": "
                     & Ada.Exceptions.Exception_Name (E));
            end;
            Session_ID := Session_ID + 1;
         or
            terminate;
         end select;
      end loop;
   end Cache_Cleanup_Task;

   procedure Verify_Peer_Identity is
      Current_Chain : Cert_Chain_Ptr := null;
   begin
      Current_Chain := new Certificate_Chain_Record'
        (Leaf => Certificate_Record'
           (Key_Algorithm    => RSA_2048,
            Subject_DN       => Null_Unbounded_String,
            Issuer_DN        => Null_Unbounded_String,
            Serial           => Null_Unbounded_String,
            Rsa_2048_Modulus => Null_Unbounded_String),
         Next => null);

      Verify_Certificate_Signature (Current_Chain);
      Safe_Free_Chain (Current_Chain);
   exception
      when Constraint_Error =>
         Safe_Free_Chain (Current_Chain);
      when others =>
         Safe_Free_Chain (Current_Chain);
         raise;
   end Verify_Peer_Identity;

   procedure Test_Double_Free_Path is
      Chain : Cert_Chain_Ptr := new Certificate_Chain_Record'
        (Leaf => Certificate_Record'
           (Key_Algorithm    => RSA_2048,
            Subject_DN       => Null_Unbounded_String,
            Issuer_DN        => Null_Unbounded_String,
            Serial           => Null_Unbounded_String,
            Rsa_2048_Modulus => Null_Unbounded_String),
         Next => null);
   begin
      Safe_Free_Chain (Chain);
      Safe_Free_Chain (Chain);
   end Test_Double_Free_Path;

   procedure Test_Discriminant_Creation is
      Raw : Curve_Parameter_Block (1 .. 48) := (others => 0);
      Cert : constant Certificate_Record := Parse_SubjectPublicKeyInfo (EC_P384, Raw);
   begin
      if Cert.Key_Algorithm /= EC_P384 then
         raise Constraint_Error with "wrong discriminant";
      end if;
   end Test_Discriminant_Creation;

   procedure Test_Cache_Evict_Finalizes is
      Chain : Cert_Chain_Ptr := new Certificate_Chain_Record'
        (Leaf => Certificate_Record'
           (Key_Algorithm    => RSA_2048,
            Subject_DN       => Null_Unbounded_String,
            Issuer_DN        => Null_Unbounded_String,
            Serial           => Null_Unbounded_String,
            Rsa_2048_Modulus => Null_Unbounded_String),
         Next => null);
   begin
      Cert_Cache.Insert (42, Chain);
      Cert_Cache.Evict (42);
   end Test_Cache_Evict_Finalizes;

   procedure Test_Cleanup_Atomic_Evict is
   begin
      Cleanup_Guard.Atomic_Evict (42);
   end Test_Cleanup_Atomic_Evict;

end TLS_Validator;

