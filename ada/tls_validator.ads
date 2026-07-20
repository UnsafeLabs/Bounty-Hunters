-- TLS Validator public API (issue #564 fixes applied in body)
package TLS_Validator is
   type Algorithm_Type is (RSA_2048, EC_P256, EC_P384);
   type Certificate_Record (Key_Algorithm : Algorithm_Type) is private;
   type Cert_Chain_Ptr is access all Certificate_Record;
   procedure Verify_Peer_Identity (Chain : in out Cert_Chain_Ptr);
   procedure Free_Chain_Safe (Chain : in out Cert_Chain_Ptr);
private
   type Certificate_Record (Key_Algorithm : Algorithm_Type) is record
      Serial : String (1 .. 40) := (others => ' ');
      case Key_Algorithm is
         when RSA_2048 =>
            null;
         when EC_P256 =>
            Curve_Params_P256 : String (1 .. 32) := (others => ' ');
         when EC_P384 =>
            Curve_Params_P384 : String (1 .. 48) := (others => ' ');
      end case;
   end record;
end TLS_Validator;
